FROM node:18-alpine

# Instalar dependencias del sistema
# ffmpeg:           Para transcodificar video a H.264/AAC compatible universal
# python3 + pip:    Necesario para yt-dlp
# curl + ca-certs:  Para descargar yt-dlp de forma segura
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    curl \
    ca-certificates

# Instalar yt-dlp desde GitHub (versión más reciente y estable)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Verificar instalaciones
RUN ffmpeg -version | head -n1 && yt-dlp --version

# Directorio de trabajo
WORKDIR /app

# Instalar dependencias de Node.js (se cachean si package.json no cambia)
COPY package.json ./
RUN npm install --production

# Copiar el código de la aplicación
COPY . .

# Actualizar yt-dlp a la última versión al construir la imagen
RUN yt-dlp -U || true

EXPOSE 3000

CMD ["node", "server.js"]