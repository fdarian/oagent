import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';
import { asChildProps, type AsChild } from './as-child';

function Collapsible(
	props: React.ComponentProps<typeof CollapsiblePrimitive.Root> & AsChild,
) {
	return (
		<CollapsiblePrimitive.Root
			data-slot="collapsible"
			{...asChildProps(props)}
		/>
	);
}

function CollapsibleTrigger(
	props: React.ComponentProps<typeof CollapsiblePrimitive.Trigger> & AsChild,
) {
	return (
		<CollapsiblePrimitive.Trigger
			data-slot="collapsible-trigger"
			{...asChildProps(props)}
		/>
	);
}

function CollapsibleContent(
	props: React.ComponentProps<typeof CollapsiblePrimitive.Panel> & AsChild,
) {
	return (
		<CollapsiblePrimitive.Panel
			data-slot="collapsible-content"
			{...asChildProps(props)}
		/>
	);
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
