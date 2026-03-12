const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del Frontend
app.use(express.static(path.join(__dirname, '../Frontend')));

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

    const args = [
        url,
        '-f', format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--no-playlist',
        '--no-warnings',
        '-o', '-' // Manda el video al stdout para streaming
    ];

    const ytDlp = spawn('yt-dlp', args);

    // Conectamos la salida de yt-dlp directamente a la respuesta HTTP
    ytDlp.stdout.pipe(res);

    ytDlp.stderr.on('data', (data) => {
        // Logueamos progreso en el servidor
        if (data.includes('%')) {
            console.log(`[PROGRESS] ${data.toString().trim()}`);
        }
    });

    ytDlp.on('close', (code) => {
        console.log(`[FINISHED] Proceso terminado con código: ${code}`);
        if (code !== 0 && !res.headersSent) {
            res.status(500).send('Error en el proceso de descarga.');
        }
    });

    // Si el usuario cancela la descarga en el navegador, matamos el proceso
    req.on('close', () => {
        ytDlp.kill();
        console.log('[CANCELLED] El usuario cerró la conexión.');
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Video Downloader Backend listo en puerto ${PORT}`);
});