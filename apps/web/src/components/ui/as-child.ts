import * as React from 'react';

export type AsChild = { asChild?: boolean };

export function asChildProps<
	P extends {
		asChild?: boolean;
		children?: React.ReactNode;
	},
>(props: P) {
	const result: P & { render?: React.ReactElement } = { ...props };
	delete result.asChild;
	if (props.asChild) {
		if (!React.isValidElement(props.children))
			throw new Error('asChild requires one React element');
		result.render = props.children;
		result.children = undefined;
	}
	return result;
}
