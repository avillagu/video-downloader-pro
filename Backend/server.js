const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del Frontend
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint de salud
app.get('/api/ping', (req, res) => {
    res.status(200).send('NexStream is awake! 🚀');
});

// Proxy para miniaturas
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

// Info del video (Metadatos)
app.get('/api/info', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL requerida' });

    const ytDlp = spawn('yt-dlp', ['--dump-json', '--no-playlist', '--no-warnings', url]);
    let output = '';
    ytDlp.stdout.on('data', (data) => { output += data; });
    ytDlp.on('close', (code) => {
        if (code !== 0) return res.status(500).json({ error: 'No se pudo obtener la info.' });
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

// Descarga en tiempo real (Streaming) - ULTRA RÁPIDO
app.get('/api/download', (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Falta la URL');

    console.log(`[STREAM] Iniciando descarga ultra-rápida: ${url}`);

    // Cabeceras de respuesta inmediata
    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    res.setHeader('Content-Type', 'video/mp4');

    // Priorizamos archivos únicos de MP4 para evitar el lento "merging"
    const FORMAT_SELECTOR = 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';

    const ytDlp = spawn('yt-dlp', [
        url,
        '-f', FORMAT_SELECTOR,
        '--no-playlist',
        '--no-warnings',
        '-o', '-' // Salida a stdout para streaming
    ]);

    // FFmpeg para compatibilidad en tiempo real
    const ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',
        '-c:v', 'libx264',
        '-preset', 'ultrafast', // Velocidad de CPU máxima
        '-tune', 'zerolatency', // Crucial para streaming
        '-crf', '28',           // Un poco más comprimido para que viaje más rápido por internet
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'baseline',
        '-level', '3.0',
        '-c:a', 'aac',
        '-b:a', '96k',          // Bajamos un poco el audio para ganar velocidad
        '-ac', '2',
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov+faststart', // Fragmentado pero con pista para empezar rápido
        'pipe:1'
    ]);

    // Conexión de tuberías (Pipes)
    ytDlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    // Manejo de errores y limpieza
    ytDlp.on('error', (err) => console.error('yt-dlp error:', err));
    ffmpeg.on('error', (err) => console.error('ffmpeg error:', err));

    req.on('close', () => {
        ytDlp.kill();
        ffmpeg.kill();
        console.log('[CLEANUP] Streaming cancelado por el usuario.');
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 NexStream Speed-Engine listo en puerto ${PORT}`);
});