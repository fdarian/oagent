import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** Register the design-system type scale (styles.css @theme) so tailwind-merge
 * treats `text-caption` etc. as font sizes, not colors — otherwise it discards
 * them when merged alongside a `text-<color>` utility. */
const twMerge = extendTailwindMerge({
	extend: {
		classGroups: {
			'font-size': [
				{ text: ['caption', 'body', 'subheading', 'heading', 'display'] },
			],
		},
	},
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
