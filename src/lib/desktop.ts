/** Desktop command and event bridge. */
export type DesktopEvent = 'model-library-changed' | 'pipeline-event' | 'generation-event' | 'backend-error' | 'download-progress' | 'transcription-event' | 'workflow-event' | 'audio-capture' | 'desktop-output' | 'plugin-state' | 'workflow-playback' | 'window-state' | 'speech-models' | 'runtime-state';
export type DesktopCommand =
  | 'backend_info' | 'get_config' | 'set_config' | 'list_audio_devices' | 'native_audio_available'
  | 'test_llm' | 'get_history'
  | 'get_model_library' | 'import_model' | 'add_model_directory' | 'remove_model_directory'
  | 'forget_model' | 'set_model_load_options' | 'load_local_model' | 'unload_local_model'
  | 'window_state' | 'window_minimize' | 'window_toggle_maximize' | 'window_close' | 'pick_model_file' | 'pick_model_directory'
  | 'hub_search' | 'hub_detail' | 'hub_download' | 'hub_downloads' | 'hub_download_action'
  | 'hub_settings' | 'hub_configure' | 'hub_open_repository' | 'hub_delete_model'
  | 'speech_models' | 'speech_model_download' | 'speech_model_import'
  | 'speech_settings' | 'speech_configure' | 'save_audio_input' | 'audio_export'
  | 'api_settings' | 'api_configure' | 'text_export'
  | 'runtime_settings' | 'runtime_install' | 'runtime_cancel' | 'runtime_pick_directory'
  | 'conversation_list' | 'conversation_get' | 'conversation_save' | 'conversation_delete'
  | 'workflow_list' | 'workflow_get' | 'workflow_save' | 'workflow_delete' | 'workflow_start' | 'workflow_status' | 'workflow_cancel' | 'workflow_export'
  | 'workflow_runs' | 'workflow_run_get' | 'workflow_context_get' | 'workflow_context_clear'
  | 'audio_capture_start' | 'audio_capture_stop' | 'audio_capture_status'
  | 'desktop_output_get' | 'desktop_output_copy' | 'plugin_list' | 'node_catalog' | 'node_plugin_directory' | 'node_plugin_reload' | 'node_plugin_toggle' | 'node_plugin_import';
export interface DesktopBridge {
  platform: 'win32' | 'darwin' | 'linux';
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  on: (event: DesktopEvent, callback: (payload: unknown) => void) => () => void;
}
declare global { interface Window { multistudioDesktop?: DesktopBridge } }

export function hasDesktop(): boolean { return typeof window !== 'undefined' && !!window.multistudioDesktop; }
export async function invoke<T = void>(command: DesktopCommand, args?: Record<string, unknown>): Promise<T> {
  if (!window.multistudioDesktop) throw new Error('桌面连接不可用，请重新启动 MultiStudio。');
  return await window.multistudioDesktop.invoke(command, args) as T;
}
export async function listen<T = unknown>(event: DesktopEvent, callback: (event: { payload: T }) => void): Promise<() => void> {
  if (!window.multistudioDesktop) return () => {};
  return window.multistudioDesktop.on(event, (payload) => callback({ payload: payload as T }));
}
