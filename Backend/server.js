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

// Endpoint de salud para cron-job.org
app.get('/api/ping', (req, res) => {
    res.status(200).send('NexStream is awake! 🚀');
});

// Proxy para saltar el bloqueo de miniaturas de Instagram/FB
app.get('/api/proxy-thumb', (req, res) => {
    const thumbUrl = req.query.url;
    if (!thumbUrl) return res.status(400).send('URL missing');

    const protocol = thumbUrl.startsWith('https') ? https : http;

    protocol.get(thumbUrl, (proxyRes) => {
        res.set('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        proxyRes.pipe(res);
    }).on('error', (e) => {
        console.error('Error in proxy-thumb:', e.message);
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
    let errorOutput = '';

    ytDlp.stdout.on('data', (data) => { output += data; });
    ytDlp.stderr.on('data', (data) => { errorOutput += data; });

    ytDlp.on('close', (code) => {
        if (code !== 0) {
            console.error(`[ERROR] yt-dlp salió con código ${code}: ${errorOutput}`);
            return res.status(500).json({ error: 'No se pudo obtener la información del video. Verifica el enlace.' });
        }
        try {
            const info = JSON.parse(output);
            res.json({
                title: info.title,
                thumbnail: info.thumbnail,
                duration: info.duration_string || '??:??',
                uploader: info.uploader,
                platform: info.extractor_key,
            });
        } catch (e) {
            console.error('[ERROR] Error parseando JSON de yt-dlp', e);
            res.status(500).json({ error: 'Error al procesar metadatos del video.' });
        }
    });

    ytDlp.on('error', (err) => {
        console.error('[ERROR] No se pudo iniciar yt-dlp:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error interno: yt-dlp no disponible.' });
        }
    });
});

// Endpoint principal de descarga
app.get('/api/download', (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Falta la URL');

    console.log(`[DOWNLOAD] Iniciando descarga: ${url}`);

    // Cabeceras para que el navegador descargue el archivo
    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    res.setHeader('Content-Type', 'video/mp4');

    // Estrategia de selección de formato:
    // Priorizamos archivos ÚNICOS (single file) para evitar fallos de merge en el pipe.
    // Solo si no hay un archivo único bueno, intentamos combinar video+audio.
    const FORMAT_SELECTOR = 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best';

    const ytDlpArgs = [
        url,
        '-f', FORMAT_SELECTOR,
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificate',
        '--prefer-free-formats',
        '-o', '-' // Salida a stdout
    ];

    const ffmpegArgs = [
        '-i', 'pipe:0',             // Entrada desde yt-dlp
        '-map', '0:v:0?',           // Mapear primer flujo de video (opcional si no existe)
        '-map', '0:a:0?',           // Mapear primer flujo de audio (opcional si no existe)
        '-c:v', 'libx264',
        '-preset', 'ultrafast',     // Volvemos a ultrafast para máxima respuesta
        '-crf', '24',
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'main',       // Perfil main es más seguro para compatibilidad móvil
        '-level', '3.1',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ac', '2',
        '-movflags', 'frag_keyframe+empty_moov', // REMOVIDO faststart (causa errores en pipes)
        '-f', 'mp4',
        'pipe:1'
    ];

    const ytDlp = spawn('yt-dlp', ytDlpArgs);
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    let ytDlpError = '';
    let ffmpegError = '';
    let headersSent = false;

    // Pipe: yt-dlp → ffmpeg → cliente
    ytDlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    // Capturar stderr de yt-dlp para diagnóstico
    ytDlp.stderr.on('data', (data) => {
        const msg = data.toString();
        ytDlpError += msg;
        if (msg.includes('[download]') && msg.includes('%')) {
            process.stdout.write(`\r[DL-PROGRESS] ${msg.trim()}`);
        } else {
            console.log(`[YT-DLP] ${msg.trim()}`);
        }
    });

    // Capturar stderr de ffmpeg para diagnóstico
    ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        ffmpegError += msg;
        // Solo loguear líneas importantes de ffmpeg, no el flujo completo
        if (msg.includes('Error') || msg.includes('error') || msg.includes('Invalid')) {
            console.error(`[FFMPEG-ERR] ${msg}`);
        }
    });

    // Manejo de error al iniciar yt-dlp
    ytDlp.on('error', (err) => {
        console.error('[FATAL] No se pudo iniciar yt-dlp:', err.message);
        ffmpeg.kill('SIGTERM');
        if (!headersSent && !res.headersSent) {
            headersSent = true;
            res.status(500).end('Error: yt-dlp no está disponible en el servidor.');
        }
    });

    // Manejo de error al iniciar ffmpeg
    ffmpeg.on('error', (err) => {
        console.error('[FATAL] No se pudo iniciar ffmpeg:', err.message);
        ytDlp.kill('SIGTERM');
        if (!headersSent && !res.headersSent) {
            headersSent = true;
            res.status(500).end('Error: ffmpeg no está disponible en el servidor.');
        }
    });

    // Cuando yt-dlp termina
    ytDlp.on('close', (code) => {
        console.log(`[YT-DLP] Proceso terminado, código: ${code}`);
        if (code !== 0) {
            console.error(`[YT-DLP-ERR] ${ytDlpError.slice(-500)}`);
            // Cerramos el stdin de ffmpeg para que pueda terminar limpiamente
            if (ffmpeg.stdin && !ffmpeg.stdin.destroyed) {
                ffmpeg.stdin.end();
            }
        }
    });

    // Cuando ffmpeg termina
    ffmpeg.on('close', (code) => {
        if (code === 0) {
            console.log('[FINISHED] ✅ Video procesado y enviado correctamente.');
        } else {
            console.error(`[FFMPEG] Terminó con código ${code}. Últimos logs: ${ffmpegError.slice(-500)}`);
        }
        if (!res.writableEnded) {
            res.end();
        }
    });

    // Si el cliente cancela la descarga, limpiamos los procesos
    req.on('close', () => {
        console.log('[CANCELLED] Conexión cerrada por el usuario, limpiando procesos...');
        ytDlp.kill('SIGTERM');
        ffmpeg.kill('SIGTERM');
    });

    // Manejar errores de escritura en la respuesta (cliente desconectado)
    res.on('error', (err) => {
        console.error('[RES-ERROR] Error en la respuesta:', err.message);
        ytDlp.kill('SIGTERM');
        ffmpeg.kill('SIGTERM');
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 NexStream Backend listo en puerto ${PORT}`);
});