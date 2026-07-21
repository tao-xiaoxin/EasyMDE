import type {
  FontControlsOptions,
  FontControlsState,
  FontOption
} from '../contracts/bootstrap/font-controls-bootstrap';

function selectedOption(
  options: ReadonlyArray<FontOption>,
  selected: string
): FontOption {
  const option = options.find(({ id }) => id === selected);
  if (!option) {
    throw new Error('font-selection-invalid');
  }

  return option;
}

export function buildFontStack(
  options: FontControlsOptions,
  state: FontControlsState
): string {
  const selected = [
    selectedOption(options.customFonts, state.customFont),
    selectedOption(options.windowsFonts, state.windowsFont),
    selectedOption(options.appleFonts, state.appleFont),
    selectedOption(options.serifOptions, state.serifFont)
  ];
  const seen = new Set<string>();
  const parts: Array<string> = [];

  for (const option of selected) {
    for (const part of option.fontFamily.split(',')) {
      const family = part.trim();
      const key = family.toLowerCase();
      if (family && !seen.has(key)) {
        seen.add(key);
        parts.push(family);
      }
    }
  }

  return parts.join(', ');
}
