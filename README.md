# NexStream | Ultra Video Downloader 🚀

NexStream es un descargador de videos profesional, multiplataforma y de alto rendimiento. Permite extraer y descargar contenido de YouTube, TikTok (sin marca de agua), Instagram, Facebook y más de 1000 sitios adicionales, todo a través de una interfaz premium y fluida.

## ✨ Características Principales

- **Arquitectura de Streaming:** No guarda archivos en el servidor. El video fluye directamente desde la fuente original al dispositivo del usuario, permitiendo descargas rápidas de archivos grandes (4K) sin límites de disco.
- **Interfaz Premium:** Diseño minimalista y moderno con previsualización dinámica de videos, miniaturas y metadatos.
- **Multiplataforma:** Soporte universal gracias al motor `yt-dlp`.
- **Selección de Calidad:** Permite elegir entre diferentes resoluciones MP4 disponibles.
- **Listo para Producción:** Configurado para desplegarse fácilmente con Docker.

## 🛠️ Tecnologías Utilizadas

- **Frontend:** HTML5, CSS3 (Vanilla Glassmorphism), JavaScript (Fetch API).
- **Backend:** Node.js, Express.js.
- **Motor de Descarga:** `yt-dlp` (el sucesor más potente de youtube-dl).
- **Procesamiento de Medios:** `FFmpeg` para la fusión de audio y video en alta definición.
- **Infraestructura:** Docker (Alpine Linux).

## 🚀 Instalación y Ejecución

### Requisitos Previos
- Node.js (v18+) o Docker instalado.
- FFmpeg y Python3 installed (si se corre fuera de Docker).

### Opción 1: Usando Docker (Recomendado)
1. Construye la imagen:
   ```bash
   cd Backend
   docker build -t nexstream .
   ```
2. Ejecuta el contenedor:
   ```bash
   docker run -p 3000:3000 nexstream
   ```

### Opción 2: Ejecución Local
1. Instala las dependencias del backend:
   ```bash
   cd Backend
   npm install
   ```
2. Asegúrate de tener `yt-dlp` y `ffmpeg` instalados en tu sistema y accesibles en el PATH.
3. Inicia el servidor:
   ```bash
   npm start
   ```

## 📂 Estructura del Proyecto

```text
video-downloader/
├── Backend/
│   ├── server.js      # Lógica del servidor y streaming
│   ├── Dockerfile     # Configuración de contenedorizada
│   └── package.json   # Dependencias de Node
├── Frontend/
│   └── index.html     # Interfaz de usuario premium
└── README.md          # Esta guía
```

## 🛡️ Notas de Seguridad y Uso
Este proyecto fue creado con fines educativos y de uso personal. Asegúrate de respetar los términos de servicio de las plataformas y los derechos de autor de los creadores de contenido.

---
NexStream Pro - Desarrollado para alta eficiencia.
