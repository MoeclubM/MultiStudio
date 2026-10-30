const parentPort = process.parentPort;
const send = message => parentPort ? parentPort.postMessage(message) : process.send(message);
const path = require('node:path');
let sherpa;
let recognizer, synthesizer, recognizerKey, synthesizerKey;
const resolveConfig = model => Object.fromEntries(Object.entries(model.config).map(([key, value]) => [key, value.split(',').map(file => path.join(model.directory, file)).join(',')]));

async function receive({ type, modulePath, id, task, model, input, output, text, language = '', threads = 4, speakerId = 49, speed = 1 }) {
  if (type === 'initialize') { sherpa = require(modulePath); return; }
  try {
    const key = JSON.stringify([model.id, language, threads]);
    const config = resolveConfig(model);
    if (task === 'asr') {
      if (recognizerKey !== key) {
        const { tokens, ...engine } = config;
        if (model.engine === 'senseVoice') Object.assign(engine, { language: language === 'auto' ? '' : language, useInverseTextNormalization: 1 });
        recognizer = await sherpa.OfflineRecognizer.createAsync({ modelConfig: { [model.engine]: engine, tokens, numThreads: threads, provider: 'cpu', debug: 0 } });
        recognizerKey = key;
      }
      const stream = recognizer.createStream(); stream.acceptWaveform(sherpa.readWave(input, false));
      const result = await recognizer.decodeAsync(stream);
      send({ id, result: { text: result.text || '' } });
    } else {
      if (synthesizerKey !== key) {
        synthesizer = await sherpa.OfflineTts.createAsync({ model: { [model.engine]: { ...config, lengthScale: 1 } }, numThreads: threads, provider: 'cpu', debug: 0, maxNumSentences: 1 });
        synthesizerKey = key;
      }
      if (!Number.isInteger(speakerId) || speakerId < 0 || speakerId >= synthesizer.numSpeakers) throw new Error(`音色编号应为 0–${synthesizer.numSpeakers - 1}`);
      const audio = await synthesizer.generateAsync({ text, sid: speakerId, speed, enableExternalBuffer: false });
      if (!audio.samples?.length) throw new Error('语音模型没有生成声音');
      sherpa.writeWave(output, audio);
      send({ id, result: { duration: audio.samples.length / audio.sampleRate, sampleRate: audio.sampleRate, speakers: synthesizer.numSpeakers } });
    }
  } catch (error) { send({ id, error: error.message }); }
}
if (parentPort) parentPort.on('message', event => void receive(event.data));
else process.on('message', message => void receive(message));
