/** What a figure is wearing. Colours are hex strings; null means "none". */
export interface Outfit {
  top: string;
  topStyle: 'unisuit' | 'tank' | 'tee' | 'longsleeve' | 'jacket';
  bottom: string;
  bottomStyle: 'unisuit' | 'shorts' | 'tights' | 'pants';
  /** Side panel / stripe colour on the top and bottom. */
  accent: string | null;
  /** Life jacket / PFD colour worn over the top. */
  pfd: string | null;
  /** Shoe colour; null = barefoot (rowers in the boat's fixed shoes). */
  shoe: string | null;
}

/** Stanford racing unisuit: cardinal with white side panels. */
export const ROWING_UNISUIT: Outfit = {
  top: '#8c1515',
  topStyle: 'unisuit',
  bottom: '#8c1515',
  bottomStyle: 'unisuit',
  accent: '#f4f2ec',
  pfd: null,
  shoe: null,
};
