FROM node:18-alpine

# Instalar dependencias del sistema de una sola vez para reducir capas
# ffmpeg: Vital para unir audio y video en alta calidad
# python3: Necesario para que yt-dlp funcione
# curl/ca-certificates: Para descargar yt-dlp de forma segura
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    curl \
    ca-certificates

# Descargar la versión más reciente de yt-dlp directamente desde GitHub
# Se guarda en /usr/local/bin para que sea accesible globalmente
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Crear directorio de la aplicación
WORKDIR /app

# Instalar dependencias de Node.js primero para aprovechar el caché de capas
COPY package.json ./
RUN npm install --production

# Copiar el resto del código
COPY . .

# yt-dlp a veces necesita actualizarse muy seguido
# Este comando asegura que al menos al construir la imagen tengamos la última
RUN yt-dlp -U || true

EXPOSE 3000

# Usar el usuario node por seguridad (opcional, pero recomendado)
# USER node

CMD ["node", "server.js"]