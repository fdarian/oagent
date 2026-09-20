import { cn } from '@/lib/utils';

export function ActionRow({
	className,
	...props
}: React.ComponentProps<'div'>) {
	return (
		<div
			className={cn('flex items-center gap-2 flex-wrap', className)}
			{...props}
		/>
	);
}
