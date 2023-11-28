import './App.css';
import { useEffect } from 'react';
import * as mediasoupClient from 'mediasoup-client';
import { io } from 'socket.io-client';

function App() {
  useEffect(() => {
    const socket = io('http://localhost:3000');

    const btnLocalVideo = document.querySelector('.local-video');
    const btnRtpCapabilities = document.querySelector('.rtp-capabilities');
    const btnCreateDevice = document.querySelector('.device');
    const btnCreateSendTransport = document.querySelector(
      '.create-send-transport'
    );
    const btnConnectSendTransport = document.querySelector(
      '.connect-send-transport'
    );
    const btnCreateRecvTransport = document.querySelector(
      '.create-recv-transport'
    );
    const btnConnectRecvTransport = document.querySelector(
      '.connect-recv-transport'
    );

    const localVideo = document.querySelector('.producer-video');
    const remoteVideo = document.querySelector('.consumer-video');

    let params = {
      encodings: [
        {
          rid: 'r0',
          maxBitrate: 100000,
          scalabilityMode: 'S1T3',
        },
        {
          rid: 'r1',
          maxBitrate: 300000,
          scalabilityMode: 'S1T3',
        },
        {
          rid: 'r2',
          maxBitrate: 900000,
          scalabilityMode: 'S1T3',
        },
      ],
      codecOptions: {
        videoGoogleStartBitrate: 1000,
      },
    };

    let device;
    let rtpCapabilities;
    let producerTransport;
    let consumerTransport;
    let producer;
    let consumer;

    const getLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
        localVideo.srcObject = stream;
        localVideo.play();
        const track = stream.getVideoTracks()[0];
        params = { track, ...params };
      } catch (err) {
        console.error(err);
      }
    };

    const createDevice = async () => {
      try {
        device = new mediasoupClient.Device();

        await device.load({
          routerRtpCapabilities: rtpCapabilities,
        });
        console.log('RTP Capabilities: ', rtpCapabilities);
      } catch (error) {
        console.error(error);
        if (error.name === 'UnsupportedError') {
          console.error('browser not supported');
        }
      }
    };

    const getRtpCapabilities = () => {
      // emit a callback function to the server
      socket.emit('getRtpCapabilities', (data) => {
        console.log('Router RTP Capabilities: ', data.rtpCapabilities);
        rtpCapabilities = data.rtpCapabilities;
      });
    };

    const createSendTransport = async () => {
      socket.emit('createWebRtcTransport', { sender: true }, ({ params }) => {
        if (params.error) {
          console.log(params.error);
          return;
        }
        console.log(params);
        producerTransport = device.createSendTransport(params);
        producerTransport.on(
          'connect',
          async ({ dtlsParameters }, callback, errback) => {
            try {
              console.log('transport connect event');
              // Signal local DTLS parameters to the server side transport
              socket.emit('connectSendTransport', {
                // transportId: producerTransport.id,
                dtlsParameters,
              });
              // Tell the transport that parameters were transmitted
              callback();
            } catch (error) {
              console.error(error);
              errback(error);
            }
          }
        );

        producerTransport.on(
          'produce',
          async (parameters, callback, errback) => {
            console.log('transport produce event');
            console.log('Parameters: ', parameters);
            try {
              socket.emit(
                'produceTransport',
                {
                  // transportId: producerTransport.id,
                  kind: parameters.kind,
                  rtpParameters: parameters.rtpParameters,
                  appData: parameters.appData,
                },
                ({ id }) => {
                  console.log('producer id: ', id);
                  // Tell the transport that parameters were transmitted
                  // and provide it with server side producer's id
                  callback({ id });
                }
              );
            } catch (error) {
              errback(error);
            }
          }
        );
      });
    };

    const connectSendTransport = async () => {
      try {
        console.log('transport connect');
        producer = await producerTransport.produce(params);

        producer.on('trackended', () => {
          console.log('track ended');
        });

        // close video track
        producer.on('transportclose', () => {
          console.log('transport ended');
        });

        console.log('producer: ', producer);
      } catch (error) {
        console.error(error);
      }
    };

    const createRecvTransport = async () => {
      socket.emit('createWebRtcTransport', { sender: false }, ({ params }) => {
        if (params.error) {
          console.log(params.error);
          return;
        }

        console.log(params);

        consumerTransport = device.createRecvTransport(params);

        consumerTransport.on(
          'connect',
          async ({ dtlsParameters }, callback, errback) => {
            try {
              console.log('consumer transport connect event');
              socket.emit('connectRecvTransport', {
                // transportId: consumerTransport.id,
                dtlsParameters,
              });
              callback();
            } catch (error) {
              console.error(error);
              errback(error);
            }
          }
        );
      });
    };

    const connectRecvTransport = async () => {
      socket.emit(
        'consume',
        {
          rtpCapabilities: device.rtpCapabilities,
        },
        async ({ params }) => {
          if (params.error) {
            console.log('Cannot Consume');
            return;
          }

          console.log(params);
          consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
          });

          const { track } = consumer;
          remoteVideo.srcObject = new MediaStream([track]);
          // const stream = new MediaStream();
          // stream.addTrack(track);
          // remoteVideo.srcObject = stream;
          // console.log(stream);

          socket.emit('resumeConsumer');
        }
      );
    };

    btnLocalVideo.addEventListener('click', getLocalStream);
    btnRtpCapabilities.addEventListener('click', getRtpCapabilities);
    btnCreateDevice.addEventListener('click', createDevice);
    btnCreateSendTransport.addEventListener('click', createSendTransport);
    btnConnectSendTransport.addEventListener('click', connectSendTransport);
    btnCreateRecvTransport.addEventListener('click', createRecvTransport);
    btnConnectRecvTransport.addEventListener('click', connectRecvTransport);

    socket.on('connect', () => {
      console.log(`a user connected`);
    });
  }, []);
  return (
    <>
      <div className="videos-container">
        <div className="producer-video__container">
          <video
            src=""
            className="producer-video"
            autoPlay
            playsInline
            muted
          ></video>
          <button className="local-video">1. Get local video</button>
        </div>
        <div className="video consumer-video__container">
          <video src="" className="consumer-video" autoPlay playsInline></video>
        </div>
      </div>
      <div className="rtp-layer">
        <button className="rtp-capabilities">2. Get rtp capabilities</button>
        <button className="device">3. Create device</button>
      </div>
      <div className="transport-layer">
        <button className="create-send-transport">
          4. Create send transport
        </button>
        <button className="connect-send-transport">
          5. Connect send transport and produce
        </button>
        <button className="create-recv-transport">
          6. Create recv transport
        </button>
        <button className="connect-recv-transport">
          7. Connect recv transport and consume
        </button>
      </div>
    </>
  );
}

export default App;
