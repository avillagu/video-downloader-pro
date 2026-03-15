const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');

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
    }).on('error', (e) => {
        res.status(500).send('Error');
    });
});

// Info del video
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
                extractor: info.extractor_key
            });
        } catch (e) {
            res.status(500).json({ error: 'Error procesando datos.' });
        }
    });
});

// Descarga con procesamiento temporal para compatibilidad total (WhatsApp)
app.get('/api/download', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Falta la URL');

    // Generar ruta de archivo temporal
    const tempFileName = `nexstream_${randomUUID()}.mp4`;
    const tempPath = path.join(os.tmpdir(), tempFileName);

    console.log(`[PROCESS] Iniciando conversión para WhatsApp: ${url}`);

    // Selección de formato: priorizar archivos únicos
    const FORMAT_SELECTOR = 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best';

    const ytDlp = spawn('yt-dlp', [
        url,
        '-f', FORMAT_SELECTOR,
        '--no-playlist',
        '--no-warnings',
        '-o', '-' // Stream a stdout
    ]);

    // FFmpeg: Transcodificar a Baseline Profile para WhatsApp
    const ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '26',               // Un poco más de compresión para que pese menos en Wpp
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'baseline',    // EL MÁS COMPATIBLE PARA WHATSAPP
        '-level', '3.0',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-movflags', '+faststart',   // Mueve metadatos al inicio para previsualización en Wpp
        '-y',                        // Sobrescribir si existe
        tempPath                     // Salida a un archivo físico, NO a tubería
    ]);

    ytDlp.stdout.pipe(ffmpeg.stdin);

    ffmpeg.on('close', (code) => {
        if (code === 0 && fs.existsSync(tempPath)) {
            console.log(`[FINISHED] Archivo listo para enviar: ${tempFileName}`);
            
            // Enviar el archivo procesado al usuario
            res.download(tempPath, 'video.mp4', (err) => {
                // Borrar archivo temporal después de enviado
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                    console.log(`[CLEANUP] Archivo temporal borrado.`);
                }
            });
        } else {
            console.error(`[ERROR] FFmpeg falló o archivo no generado.`);
            if (!res.headersSent) res.status(500).send('Error al procesar el video.');
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }
    });

    // Cancelación si el usuario cierra la conexión
    req.on('close', () => {
        ytDlp.kill();
        ffmpeg.kill();
        // Esperar un poco para borrar el archivo si se estaba creando
        setTimeout(() => { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); }, 1000);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 NexStream Backend listo en puerto ${PORT}`);
});