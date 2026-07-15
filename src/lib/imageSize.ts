/** GPT-image-2 的高分辨率自定义画幅约束。 */
export function isValidHighResImageSize(size: string): boolean {
  const match = size.match(/^(\d+)x(\d+)$/i);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  const aspect = Math.max(width, height) / Math.min(width, height);
  return (
    width % 16 === 0 &&
    height % 16 === 0 &&
    Math.max(width, height) <= 3840 &&
    aspect <= 3 &&
    pixels >= 655_360 &&
    pixels <= 8_294_400
  );
}
