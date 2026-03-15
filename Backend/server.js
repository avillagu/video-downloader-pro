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

    // IMPORTANTE: No enviamos headers hasta que tengamos datos reales.
    // Esto nos permite enviar un error HTTP si algo falla antes de empezar.
    let headersSent = false;
    let ytDlpError = '';
    let ffmpegError = '';

    // Usamos 'best[ext=mp4]' como primera opción porque es un stream ÚNICO
    // ya pre-muxeado (video+audio juntos). yt-dlp NO puede muxear
    // bestvideo+bestaudio cuando la salida es stdout (-o -), porque necesita
    // un archivo temporal para combinar los streams.
    // Fallback: 'best' para cualquier formato disponible.
    const FORMAT_SELECTOR = 'best[ext=mp4][height<=720]/best[ext=mp4]/best[height<=720]/best';

    const ytDlp = spawn('yt-dlp', [
        url,
        '-f', FORMAT_SELECTOR,
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '-o', '-'
    ]);

    // Capturamos stderr de yt-dlp para diagnóstico
    ytDlp.stderr.on('data', (data) => {
        ytDlpError += data.toString();
        console.error('[yt-dlp stderr]', data.toString().trim());
    });

    // ffmpeg re-codifica a H.264/AAC para compatibilidad universal
    const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'baseline',
        '-level', '3.0',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        '-f', 'mp4',
        'pipe:1'
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    // Capturamos stderr de ffmpeg para diagnóstico
    ffmpeg.stderr.on('data', (data) => {
        ffmpegError += data.toString();
        console.error('[ffmpeg stderr]', data.toString().trim());
    });

    // Cuando ffmpeg produce los PRIMEROS datos, enviamos los headers
    ffmpeg.stdout.on('data', (chunk) => {
        if (!headersSent) {
            headersSent = true;
            res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Transfer-Encoding', 'chunked');
        }
        // Escribimos el chunk al response. Si el cliente se desconectó, .write() fallará silenciosamente.
        if (!res.writableEnded) {
            res.write(chunk);
        }
    });

    // Cuando ffmpeg termina de enviar datos
    ffmpeg.stdout.on('end', () => {
        if (!headersSent) {
            // ffmpeg nunca produjo datos → error
            console.error('[DOWNLOAD FAIL] ffmpeg no produjo datos.');
            console.error('[yt-dlp errors]', ytDlpError);
            console.error('[ffmpeg errors]', ffmpegError);
            if (!res.headersSent) {
                res.status(500).json({
                    error: 'No se pudo procesar el video. Intenta con otro enlace.',
                    details: ytDlpError || ffmpegError || 'Sin detalles'
                });
            }
        } else {
            // Todo OK, cerramos la respuesta
            if (!res.writableEnded) {
                res.end();
            }
        }
    });

    // Conectar yt-dlp → ffmpeg
    ytDlp.stdout.pipe(ffmpeg.stdin);

    // Manejar errores de yt-dlp
    ytDlp.on('error', (err) => {
        console.error('[yt-dlp spawn error]', err.message);
        if (!headersSent && !res.headersSent) {
            res.status(500).json({ error: 'Error al iniciar yt-dlp: ' + err.message });
        }
    });

    // Manejar errores de ffmpeg
    ffmpeg.on('error', (err) => {
        console.error('[ffmpeg spawn error]', err.message);
        if (!headersSent && !res.headersSent) {
            res.status(500).json({ error: 'Error al iniciar ffmpeg: ' + err.message });
        }
    });

    // Evitar que el pipe de yt-dlp→ffmpeg rompa si ffmpeg cierra primero
    ffmpeg.stdin.on('error', () => { /* ignorar EPIPE */ });

    // Si el cliente cierra la conexión, matar los procesos
    req.on('close', () => {
        ytDlp.kill('SIGTERM');
        ffmpeg.kill('SIGTERM');
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Engine optimizado para Render en puerto ${PORT}`));