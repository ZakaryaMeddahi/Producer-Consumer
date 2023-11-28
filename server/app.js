import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as mediasoup from 'mediasoup';
import path from 'path';

const app = express();
const server = createServer(app);

// const __dirname = path.resolve();

app.use(express.static('public'));

// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, 'views', 'index.html'));
// });

const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
  },
});

let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

const createWorker = async () => {
  const worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log(`worker created pid: ${worker.pid}`);
  worker.on('died', () => {
    console.error(`worker died pid: ${worker.pid}, exit in 2 seconds!`);
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  });

  return worker;
};

const createWebRtcTransport = async (callback) => {
  try {
    const transport = await router.createWebRtcTransport({
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: '127.0.0.1',
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    transport.on('dtlsstatechange', (dtlsState) => {
      console.log(`transport id: ${transport.id}`);
      if (dtlsState === 'closed') {
        console.log('transport close');
        transport.close();
      }
    });

    transport.on('close', () => {
      console.log('transport closed');
    });

    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    });

    return transport;
  } catch (error) {
    console.error(error);
    callback({
      params: {
        error: error,
      },
    });
  }
};

worker = await createWorker();
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

io.on('connection', async (socket) => {
  console.log(`a user connected: ${socket.id}`);
  router = await worker.createRouter({ mediaCodecs });

  socket.on('getRtpCapabilities', (callback) => {
    const rtpCapabilities = router.rtpCapabilities;
    console.log('getRtpCapabilities', rtpCapabilities);
    const message = {
      rtpCapabilities,
    };
    callback(message);
  });

  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    // console.log('createWebRtcTransport', params);
    if (sender) {
      producerTransport = await createWebRtcTransport(callback);
    } else {
      consumerTransport = await createWebRtcTransport(callback);
    }
  });

  socket.on('connectSendTransport', async ({ dtlsParameters }) => {
    console.log('DTLS params... ', { dtlsParameters });
    await producerTransport.connect({ dtlsParameters });
  });

  socket.on(
    'produceTransport',
    async ({ kind, rtpParameters, appData }, callback) => {
      producer = await producerTransport.produce({
        kind,
        rtpParameters,
      });
      console.log('RTP params... ', { rtpParameters });

      console.log('Producer ID: ', producer.id, producer.kind);

      producer.on('transportclose', () => {
        console.log('producer transport close');
        producer.close();
      });

      callback({
        id: producer.id,
      });
    }
  );

  socket.on('connectRecvTransport', async ({ dtlsParameters }) => {
    console.log('DTLS params... ', { dtlsParameters });
    await consumerTransport.connect({ dtlsParameters });
  });

  socket.on('consume', async ({ rtpCapabilities }, callback) => {
    try {
      if (
        router.canConsume({
          producerId: producer.id,
          rtpCapabilities,
        })
      ) {
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });

        consumer.on('transportclose', () => {
          console.log('transport close from consumer');
        });

        producer.on('producerclose', () => {
          console.log('producer of consumer closed');
        });

        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };

        console.log(params);

        callback({ params });
      }
    } catch (error) {
      console.error(error.message);
      callback({
        params: error,
      });
    }
  });

  socket.on('resumeConsumer', async () => {
    console.log('consumer resume');
    await consumer.resume();
  });

  socket.on('disconnect', () => {
    console.log(`user disconnected: ${socket.id}`);
  });
});

server.listen(3000, () => {
  console.log('Server is running on port 3000');
});
