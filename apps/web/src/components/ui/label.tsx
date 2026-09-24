import { Field } from '@base-ui/react/field';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function Label(props: React.ComponentProps<typeof Field.Label>) {
	return (
		<Field.Label
			data-slot="label"
			className={cn(
				'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
				props.className,
			)}
			{...props}
		/>
	);
}

export { Label };
