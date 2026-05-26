import { Link } from 'react-router-dom';

export function AliasesPage() {
	return (
		<div className="flex h-screen w-screen flex-col bg-background">
			<header className="flex items-center justify-between border-b border-border px-22 py-15">
				<div className="flex items-center gap-22">
					<Link
						to="/"
						className="text-subheading font-light text-foreground hover:text-primary"
					>
						oagent
					</Link>
					<span className="text-body text-muted-foreground">/</span>
					<span className="text-subheading font-light text-foreground">
						Aliases
					</span>
				</div>
			</header>
			<main className="flex-1 overflow-y-auto px-33 py-22">
				<div className="mx-auto max-w-[900px]">
					<p className="text-body text-muted-foreground">
						Model aliases settings page
					</p>
				</div>
			</main>
		</div>
	);
}
