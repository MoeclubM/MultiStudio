import { WorkflowAudioInput, type AudioWidgetProps } from './WorkflowAudioInput';

export function WorkflowAudioReference({ nodeId, config, disabled, onChange }: AudioWidgetProps) {
  return <div aria-label="参考音频"><WorkflowAudioInput nodeId={nodeId} disabled={disabled}
    config={{ audioId: config.referenceAudioId, filename: config.referenceFilename, duration: config.referenceDuration }}
    onChange={audio => onChange({ ...config, referenceAudioId: audio.audioId, referenceFilename: audio.filename, referenceDuration: audio.duration })} /></div>;
}
