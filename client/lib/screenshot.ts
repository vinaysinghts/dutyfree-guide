import { Platform } from 'react-native';
import { captureScreen } from 'react-native-view-shot';

/**
 * Screenshot of what's on screen right now, as a URI that fetch() can read
 * (a temp file on phones, a data: URI in the browser via html2canvas-pro).
 * Returns null instead of throwing: a report without a screenshot is still useful.
 */
export async function captureCurrentScreen(): Promise<string | null> {
  try {
    return await captureScreen({ format: 'jpg', quality: 0.7, result: Platform.OS === 'web' ? 'data-uri' : 'tmpfile' });
  } catch (e) {
    console.warn('Screenshot failed', e);
    return null;
  }
}
