'use client';

import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { UIMessage } from 'ai';
import { ArrowDownIcon, DownloadIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import {
	createContext,
	useCallback,
	useContext,
	useLayoutEffect,
	useRef,
} from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ConversationContextValue = {
	virtualizer: Virtualizer<HTMLDivElement, Element>;
	scrollRef: React.RefObject<HTMLDivElement | null>;
};

const ConversationContext = createContext<ConversationContextValue | null>(
	null,
);

function useConversationContext(): ConversationContextValue {
	const value = useContext(ConversationContext);
	if (value === null) {
		throw new Error(
			'Conversation sub-components must be rendered inside <Conversation>',
		);
	}
	return value;
}

export type ConversationProps = ComponentProps<'div'> & {
	count: number;
	getItemKey: (index: number) => string;
	estimateSize?: () => number;
};

export const Conversation = ({
	count,
	getItemKey,
	estimateSize = () => 72,
	className,
	children,
	...props
}: ConversationProps) => {
	const scrollRef = useRef<HTMLDivElement>(null);
	const virtualizer = useVirtualizer({
		count,
		getScrollElement: () => scrollRef.current,
		estimateSize,
		getItemKey,
		anchorTo: 'end',
		followOnAppend: true,
		scrollEndThreshold: 80,
		overscan: 6,
	});

	useLayoutEffect(() => {
		virtualizer.scrollToEnd();
	}, [virtualizer]);

	return (
		<div
			className={cn('relative flex flex-1 flex-col min-h-0', className)}
			role="log"
			{...props}
		>
			<ConversationContext.Provider value={{ virtualizer, scrollRef }}>
				{children}
			</ConversationContext.Provider>
		</div>
	);
};

export type ConversationContentProps = {
	className?: string;
	header?: ReactNode;
	children: (virtualItem: VirtualItem) => ReactNode;
};

export const ConversationContent = ({
	className,
	header,
	children,
}: ConversationContentProps) => {
	const { virtualizer, scrollRef } = useConversationContext();
	const virtualItems = virtualizer.getVirtualItems();

	return (
		<div ref={scrollRef} className="flex-1 overflow-y-auto">
			{header !== undefined && (
				<div className="sticky top-0 z-10 bg-background">{header}</div>
			)}
			<div
				className={cn('relative w-full', className)}
				style={{ height: `${virtualizer.getTotalSize()}px` }}
			>
				{virtualItems.map((virtualItem) => (
					<div
						key={virtualItem.key}
						ref={virtualizer.measureElement}
						data-index={virtualItem.index}
						style={{
							position: 'absolute',
							top: 0,
							left: 0,
							width: '100%',
							transform: `translateY(${virtualItem.start}px)`,
						}}
					>
						{children(virtualItem)}
					</div>
				))}
			</div>
		</div>
	);
};

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
	title?: string;
	description?: string;
	icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
	className,
	title = 'No messages yet',
	description = 'Start a conversation to see messages here',
	icon,
	children,
	...props
}: ConversationEmptyStateProps) => (
	<div
		className={cn(
			'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
			className,
		)}
		{...props}
	>
		{children ?? (
			<>
				{icon && <div className="text-muted-foreground">{icon}</div>}
				<div className="space-y-1">
					<h3 className="font-medium text-sm">{title}</h3>
					{description && (
						<p className="text-muted-foreground text-sm">{description}</p>
					)}
				</div>
			</>
		)}
	</div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
	className,
	...props
}: ConversationScrollButtonProps) => {
	const { virtualizer } = useConversationContext();

	if (virtualizer.isAtEnd()) {
		return null;
	}

	return (
		<Button
			className={cn(
				'absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted',
				className,
			)}
			onClick={() => virtualizer.scrollToEnd()}
			size="icon"
			type="button"
			variant="outline"
			{...props}
		>
			<ArrowDownIcon className="size-4" />
		</Button>
	);
};

const getMessageText = (message: UIMessage): string =>
	message.parts
		.filter((part) => part.type === 'text')
		.map((part) => part.text)
		.join('');

export type ConversationDownloadProps = Omit<
	ComponentProps<typeof Button>,
	'onClick'
> & {
	messages: UIMessage[];
	filename?: string;
	formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
	const roleLabel =
		message.role.charAt(0).toUpperCase() + message.role.slice(1);
	return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
	messages: UIMessage[],
	formatMessage: (
		message: UIMessage,
		index: number,
	) => string = defaultFormatMessage,
): string => messages.map((msg, i) => formatMessage(msg, i)).join('\n\n');

export const ConversationDownload = ({
	messages,
	filename = 'conversation.md',
	formatMessage = defaultFormatMessage,
	className,
	children,
	...props
}: ConversationDownloadProps) => {
	const handleDownload = useCallback(() => {
		const markdown = messagesToMarkdown(messages, formatMessage);
		const blob = new Blob([markdown], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		document.body.append(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}, [messages, filename, formatMessage]);

	return (
		<Button
			className={cn(
				'absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted',
				className,
			)}
			onClick={handleDownload}
			size="icon"
			type="button"
			variant="outline"
			{...props}
		>
			{children ?? <DownloadIcon className="size-4" />}
		</Button>
	);
};
