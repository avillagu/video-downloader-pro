const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path');
const https = require('https'); // Para el proxy de miniaturas

const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del Frontend (ahora en la carpeta public)
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint de salud para cron-job.org
app.get('/api/ping', (req, res) => {
    res.status(200).send('NexStream is awake! 🚀');
});

// Proxy para saltar el bloqueo de miniaturas de Instagram/FB
app.get('/api/proxy-thumb', (req, res) => {
    const thumbUrl = req.query.url;
    if (!thumbUrl) return res.status(400).send('URL missing');
    
    https.get(thumbUrl, (proxyRes) => {
        // Copiamos el tipo de contenido original
        res.set('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
        // Cachear las miniaturas por 1 día para mejorar rendimiento
        res.set('Cache-Control', 'public, max-age=86400');
        proxyRes.pipe(res);
    }).on('error', (e) => {
        console.error('Error in proxy-thumb:', e);
        res.status(500).send('Error');
    });
});

// Endpoint para obtener información del video antes de descargar
app.get('/api/info', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL requerida' });

    console.log(`[INFO] Extrayendo metadatos para: ${url}`);

    const ytDlp = spawn('yt-dlp', [
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        url
    ]);

    let output = '';
    ytDlp.stdout.on('data', (data) => { output += data; });

    ytDlp.on('close', (code) => {
        if (code !== 0) {
            console.error(`[ERROR] yt-dlp salió con código ${code}`);
            return res.status(500).json({ error: 'No se pudo obtener la información del video. Verifica el enlace.' });
        }
        try {
            const info = JSON.parse(output);
            res.json({
                title: info.title,
                thumbnail: info.thumbnail,
                duration: info.duration_string,
                uploader: info.uploader,
                platform: info.extractor_key,
                formats: info.formats.filter(f => f.ext === 'mp4').map(f => ({
                    format_id: f.format_id,
                    resolution: f.resolution,
                    filesize: f.filesize
                })).slice(0, 5) // Devolvemos los 5 mejores formatos MP4
            });
        } catch (e) {
            console.error('[ERROR] Error parseando JSON de yt-dlp', e);
            res.status(500).json({ error: 'Error al procesar metadatos del video.' });
        }
    });
});

// Endpoint principal de descarga
app.get('/api/download', (req, res) => {
    const { url, format } = req.query;
    if (!url) return res.status(400).send('Falta la URL');

    console.log(`[DOWNLOAD] Iniciando descarga: ${url}`);

    // Configuración de cabeceras para streaming de video
    // Usamos el formato sugerido o el mejor disponible
    res.header('Content-Disposition', `attachment; filename="video.mp4"`);
    res.header('Content-Type', 'video/mp4');

    // Forzamos la descarga en MP4 H.264 para compatibilidad universal
    const args = [
        url,
        '-f', format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--no-playlist',
        '--no-warnings',
        '-o', '-' 
    ];

    const ytDlp = spawn('yt-dlp', args);
    
    // Usamos FFmpeg para asegurar compatibilidad total:
    // 1. -pix_fmt yuv420p: Crucial para que se vea en iPhone/Android.
    // 2. Transcodificamos a H.264 y AAC de forma ultra-rápida.
    const ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',             // Entrada desde yt-dlp
        '-c:v', 'libx264',          // Codec de video universal
        '-preset', 'ultrafast',     // Máxima velocidad para que no parezca que tarda
        '-crf', '25',               // Calidad buena (un poco más comprimida para rapidez)
        '-pix_fmt', 'yuv420p',      // EL SECRETO: Formato de píxeles compatible con móviles
        '-profile:v', 'main',       // Perfil Main: equilibrio perfecto entre calidad y compatibilidad móvil
        '-level', '3.1',            // Nivel 3.1: Asegura que funcione en dispositivos antiguos y modernos
        '-c:a', 'aac',              // Codec de audio universal
        '-b:a', '128k',             // Calidad de audio estándar
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        'pipe:1'
    ]);

    ytDlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    ytDlp.stderr.on('data', (data) => {
        if (data.includes('%')) console.log(`[DL-PROGRESS] ${data.toString().trim()}`);
    });

    ffmpeg.stderr.on('data', (data) => {
        // Log de ffmpeg para debugging si es necesario
    });

    ffmpeg.on('close', (code) => {
        console.log(`[FINISHED] FFmpeg terminado con código: ${code}`);
        if (code !== 0 && !res.headersSent) {
            res.status(500).send('Error al procesar el video para compatibilidad.');
        }
    });

    req.on('close', () => {
        ytDlp.kill();
        ffmpeg.kill();
        console.log('[CANCELLED] Conexión cerrada por el usuario.');
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Video Downloader Backend listo en puerto ${PORT}`);
});