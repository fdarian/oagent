export function stripChildTitlePrefix(
	label: string,
	childTitle: string,
	childDescription?: string,
): string {
	const titlePrefix = `${childTitle}: `;
	if (label.startsWith(titlePrefix)) {
		return label.slice(titlePrefix.length);
	}

	if (childDescription !== undefined) {
		const descriptionPrefix = `${childDescription}: `;
		if (label.startsWith(descriptionPrefix)) {
			return label.slice(descriptionPrefix.length);
		}
	}

	return label;
}
