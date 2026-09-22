import type { ToolCallContent } from '@oagent/engine';
import { useEffect, useState } from 'react';
import {
	type JobTimelineToolAttachment,
	JobTimelineToolAttachmentBlock,
	JobTimelineToolContentBlock,
	readToolAttachments,
	toolContentKey,
} from '@/components/job-timeline-tool-content';

type SyntaxClassName =
	| 'plain'
	| 'comment'
	| 'string'
	| 'number'
	| 'keyword'
	| 'type'
	| 'function'
	| 'constant'
	| 'operator';

type SyntaxSpan = {
	type: SyntaxClassName;
	start: number;
	end: number;
};

type SourcePart = {
	key: string;
	text: string;
	className: string;
};

const syntaxClassNames: Record<SyntaxClassName, string> = {
	plain: 'text-foreground',
	comment: 'text-muted-foreground',
	string: 'text-emerald-600 dark:text-emerald-400',
	number: 'text-amber-600 dark:text-amber-400',
	keyword: 'text-violet-600 dark:text-violet-400',
	type: 'text-sky-600 dark:text-sky-400',
	function: 'text-blue-600 dark:text-blue-400',
	constant: 'text-orange-600 dark:text-orange-400',
	operator: 'text-rose-600 dark:text-rose-400',
};

const focusableScrollRegionProps = { tabIndex: 0 };

function sourceParts(code: string, spans: SyntaxSpan[]): SourcePart[] {
	const orderedSpans = [...spans].sort((left, right) => {
		if (left.start !== right.start) return left.start - right.start;
		return left.end - right.end;
	});
	const reduced = orderedSpans.reduce(
		(state, span, index) => {
			const start = Math.min(Math.max(span.start, state.position), code.length);
			const end = Math.min(Math.max(span.end, start), code.length);
			const parts = [...state.parts];
			if (start > state.position) {
				parts.push({
					key: `plain-${index}`,
					text: code.slice(state.position, start),
					className: syntaxClassNames.plain,
				});
			}
			if (end > start) {
				parts.push({
					key: `span-${index}`,
					text: code.slice(start, end),
					className: syntaxClassNames[span.type],
				});
			}
			return { position: end, parts };
		},
		{ position: 0, parts: [] as SourcePart[] },
	);

	if (reduced.position < code.length) {
		reduced.parts.push({
			key: 'plain-tail',
			text: code.slice(reduced.position),
			className: syntaxClassNames.plain,
		});
	}
	return reduced.parts;
}

function Source(props: { code: string; spans: SyntaxSpan[] | null }) {
	const parts =
		props.spans === null
			? [
					{
						key: 'source',
						text: props.code,
						className: syntaxClassNames.plain,
					},
				]
			: sourceParts(props.code, props.spans);

	return (
		<pre className="m-0 whitespace-pre p-3 text-xs leading-relaxed">
			<code className="font-mono text-xs">
				{parts.map((part) => (
					<span key={part.key} className={part.className}>
						{part.text}
					</span>
				))}
			</code>
		</pre>
	);
}

function CodeModeSource(props: { code: string }) {
	const [highlighted, setHighlighted] = useState<{
		code: string;
		spans: SyntaxSpan[] | null;
	}>({ code: props.code, spans: null });
	const spans = highlighted.code === props.code ? highlighted.spans : null;

	useEffect(() => {
		const request = { cancelled: false };
		setHighlighted({ code: props.code, spans: null });

		if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
			return () => {
				request.cancelled = true;
			};
		}

		void (async () => {
			try {
				const gpuLexer = await import('gpu-lexer');
				const nextSpans = await gpuLexer.parse(props.code);
				if (!request.cancelled) {
					setHighlighted({ code: props.code, spans: nextSpans });
				}
			} catch (error) {
				if (request.cancelled) return;
				console.warn('Code Mode syntax highlighting unavailable:', error);
				setHighlighted({ code: props.code, spans: null });
			}
		})();

		return () => {
			request.cancelled = true;
		};
	}, [props.code]);

	return <Source code={props.code} spans={spans} />;
}

function hasImageContent(content: ToolCallContent[]): boolean {
	return content.some(
		(item) => item.type === 'content' && item.content.type === 'image',
	);
}

function attachmentKey(attachment: JobTimelineToolAttachment): string {
	const values = [
		attachment.url,
		attachment.filename,
		attachment.mime,
		attachment.type,
	].filter((value): value is string => value !== undefined);
	return values.length > 0 ? values.join(':') : 'attachment';
}

function CodeModePreview(props: {
	content: ToolCallContent[];
	output?: string;
	rawOutput: unknown;
}) {
	const content = props.content.filter(
		(item) => item.type !== 'content' || item.content.type !== 'text',
	);
	const hasContentImage = hasImageContent(props.content);
	const attachments = readToolAttachments(props.rawOutput).filter(
		(attachment) =>
			attachment.mime?.startsWith('image/') !== true || !hasContentImage,
	);
	const hasPreview =
		(props.output !== undefined && props.output.length > 0) ||
		content.length > 0 ||
		attachments.length > 0;

	if (!hasPreview) return null;
	return (
		<div className="space-y-3 border-border border-t bg-muted/30 p-3 text-muted-foreground">
			{props.output !== undefined && props.output.length > 0 && (
				<pre className="m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap">
					{props.output}
				</pre>
			)}
			{content.length > 0 && (
				<div className="space-y-3">
					{content.map((item, index) => (
						<JobTimelineToolContentBlock
							key={toolContentKey(item, index)}
							content={item}
						/>
					))}
				</div>
			)}
			{attachments.length > 0 && (
				<div className="space-y-3">
					{attachments.map((attachment) => (
						<JobTimelineToolAttachmentBlock
							key={attachmentKey(attachment)}
							attachment={attachment}
						/>
					))}
				</div>
			)}
		</div>
	);
}

export type JobTimelineCodeModeProps = {
	code: string;
	content: ToolCallContent[];
	output?: string;
	rawOutput?: unknown;
};

export function JobTimelineCodeMode(props: JobTimelineCodeModeProps) {
	return (
		<section
			aria-label="Code Mode source and output preview"
			className="max-h-[28rem] overflow-auto rounded-md border bg-background outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
			{...focusableScrollRegionProps}
		>
			<CodeModeSource code={props.code} />
			<CodeModePreview
				content={props.content}
				output={props.output}
				rawOutput={props.rawOutput}
			/>
		</section>
	);
}
