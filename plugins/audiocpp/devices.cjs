function selectBackend(device = 'auto', platform = process.platform, nvidia = false) {
  if (device === 'auto') return platform === 'darwin' ? 'metal' : platform === 'win32' ? nvidia ? 'cuda' : 'vulkan' : 'cpu';
  if (device === 'cuda' && !nvidia) throw new Error('CUDA 需要 NVIDIA 显卡；其他显卡请选择 Vulkan 或 CPU');
  return device;
}
module.exports = { selectBackend };
