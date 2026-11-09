/**
 * On-device OCR for iOS/Android using Google ML Kit (free, offline, fast).
 * Needs a development build (`npx expo run:ios|android` or EAS); it isn't in Expo Go.
 * The web version lives in ocr.web.ts; Metro picks the right file per platform.
 */
import TextRecognition from '@react-native-ml-kit/text-recognition';

export async function readText(imageUri: string): Promise<string> {
  const result = await TextRecognition.recognize(imageUri);
  // One line per OCR line keeps the tag's layout, which the parser relies on.
  return result.blocks.flatMap((b) => b.lines.map((l) => l.text)).join('\n');
}
