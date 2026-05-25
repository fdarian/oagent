import type { BundledLanguage } from 'shiki';

export function detectLanguage(body: string): BundledLanguage {
	try {
		JSON.parse(body);
		return 'json';
	} catch {
		return 'text' as BundledLanguage;
	}
}
