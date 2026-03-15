const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/ping', (req, res) => res.status(200).send('NexStream is awake! 🚀'));

app.get('/api/proxy-thumb', (req, res) => {
    const thumbUrl = req.query.url;
    if (!thumbUrl) return res.status(400).send('URL missing');
    const protocol = thumbUrl.startsWith('https') ? https : http;
    protocol.get(thumbUrl, (proxyRes) => {
        res.set('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        proxyRes.pipe(res);
    }).on('error', (e) => res.status(500).send('Error'));
});

app.get('/api/info', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL requerida' });
    const ytDlp = spawn('yt-dlp', ['--dump-json', '--no-playlist', '--no-warnings', url]);
    let output = '';
    ytDlp.stdout.on('data', (data) => { output += data; });
    ytDlp.on('close', (code) => {
        if (code !== 0) return res.status(500).json({ error: 'Error al obtener info.' });
        try {
            const info = JSON.parse(output);
            res.json({
                title: info.title,
                thumbnail: info.thumbnail,
                duration: info.duration_string || '??:??',
                platform: info.extractor_key
            });
        } catch (e) { res.status(500).json({ error: 'Error procesando datos.' }); }
    });
});

app.get('/api/download', (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Falta URL');

    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    res.setHeader('Content-Type', 'video/mp4');

    // Optimizamos la selección de formato para evitar que yt-dlp pierda tiempo
    // Preferimos formatos MP4 que ya estén listos
    const FORMAT_SELECTOR = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best';

    const ytDlp = spawn('yt-dlp', [
        url,
        '-f', FORMAT_SELECTOR,
        '--no-playlist',
        '--no-warnings',
        '-o', '-'
    ]);

    // CONFIGURACIÓN DE ALTA VELOCIDAD PARA FFMPEG (Render Free optimization)
    const ffmpegArgs = [
        '-i', 'pipe:0',
        '-threads', '0',             // Usar toda la CPU disponible
        '-c:v', 'libx264',
        '-preset', 'ultrafast',      // El modo más rápido de codificación
        '-crf', '30',                // Ligera reducción de calidad para ganar muchísima velocidad
        '-vf', 'scale=-2:min(720\,ih)', // Limitar a 720p máximo (ahorra muchísima CPU)
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'baseline',
        '-level', '3.0',
        '-c:a', 'aac',
        '-b:a', '64k',               // Audio ligero para comprimir más rápido
        '-ac', '2',
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        'pipe:1'
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ytDlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    req.on('close', () => {
        ytDlp.kill();
        ffmpeg.kill();
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Engine optimizado para Render en puerto ${PORT}`));