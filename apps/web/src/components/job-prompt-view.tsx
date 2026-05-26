import { ClipboardCheckIcon, ClipboardIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type JobPromptViewProps = {
	prompt: string;
	onClose: () => void;
};

export function JobPromptView({ prompt, onClose }: JobPromptViewProps) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [onClose]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(prompt).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}, [prompt]);

	const lineCount = prompt.split('\n').length;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* Header bar */}
			<div className="flex items-center justify-between border-b border-border px-33 py-22">
				<span className="font-mono text-caption uppercase tracking-widest text-muted-foreground">
					prompt
					<span className="ml-[1.5ch] text-border">
						{lineCount} {lineCount === 1 ? 'line' : 'lines'}
					</span>
				</span>
				<div className="flex items-center gap-15">
					<button
						type="button"
						onClick={handleCopy}
						className="flex items-center gap-1 border border-border px-2 py-1 text-caption text-muted-foreground transition-colors hover:border-ink hover:text-foreground"
					>
						{copied ? (
							<ClipboardCheckIcon className="h-3 w-3" />
						) : (
							<ClipboardIcon className="h-3 w-3" />
						)}
						{copied ? 'Copied' : 'Copy'}
					</button>
					<button
						type="button"
						onClick={onClose}
						className="flex items-center gap-1 border border-border px-2 py-1 text-caption text-muted-foreground transition-colors hover:border-ink hover:text-foreground"
					>
						<XIcon className="h-3 w-3" />
						Close
					</button>
				</div>
			</div>

			{/* Prompt body */}
			<div className="min-h-0 flex-1 overflow-y-auto px-33 py-22">
				<pre className="whitespace-pre-wrap font-mono text-body font-light leading-relaxed text-foreground">
					{prompt}
				</pre>
			</div>
		</div>
	);
}
