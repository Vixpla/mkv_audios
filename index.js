import http from 'node:http';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';

const PORT = process.env.PORT || 3000;

function getSpanishAudioTrackIndex(videoUrl) {
  return new Promise((resolve) => {
    // Apunta directamente al binario 'ffprobe' instalado en Linux/Docker
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      videoUrl
    ]);

    let stdoutData = '';
    ffprobe.stdout.on('data', (chunk) => { stdoutData += chunk; });

    ffprobe.on('close', (code) => {
      if (code !== 0) return resolve(0);

      try {
        const metadata = JSON.parse(stdoutData);
        const audioStreams = (metadata.streams || []).filter(s => s.codec_type === 'audio');
        if (audioStreams.length === 0) return resolve(0);

        const spanishKeywords = ['spa', 'es', 'spanish', 'lat', 'es-419', 'es-la', 'espanol'];
        
        const spanishTrack = audioStreams.find(stream => {
          const lang = (stream.tags?.language || '').toLowerCase();
          const title = (stream.tags?.title || '').toLowerCase();
          return spanishKeywords.some(kw => lang.includes(kw) || title.includes(kw));
        });

        if (spanishTrack) {
          const relativeIndex = audioStreams.indexOf(spanishTrack);
          return resolve(relativeIndex >= 0 ? relativeIndex : 0);
        }
        resolve(0);
      } catch (err) {
        resolve(0);
      }
    });
    
    ffprobe.on('error', () => resolve(0));
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname === '/audio') {
    const videoUrl = reqUrl.searchParams.get('url');

    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Falta el parámetro "?url="');
    }

    try {
      const audioTrackIndex = await getSpanishAudioTrackIndex(videoUrl);

      res.writeHead(200, {
        'Content-Type': 'audio/aac',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
        'Accept-Ranges': 'none'
      });

      // Apunta directamente al binario 'ffmpeg' del sistema
      const ffmpeg = spawn('ffmpeg', [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', videoUrl,
        '-map', `0:a:${audioTrackIndex}`,
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ac', '2',
        '-f', 'adts',
        'pipe:1'
      ]);

      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on('data', () => {});

      req.on('close', () => {
        if (!ffmpeg.killed) {
          ffmpeg.stdout.unpipe(res);
          ffmpeg.kill('SIGKILL');
        }
      });

      ffmpeg.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error interno en FFmpeg');
        }
      });

    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error al procesar el audio');
      }
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Ruta no encontrada');
  }
});

server.listen(PORT, () => {
  console.log(`Servidor de audio activo en puerto ${PORT}`);
});
