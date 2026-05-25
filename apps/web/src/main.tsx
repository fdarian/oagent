import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { queryClient } from './lib/query.ts';
import { ThemeProvider } from './lib/theme.tsx';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Root element not found');
createRoot(root).render(
	<StrictMode>
		<ThemeProvider>
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>
		</ThemeProvider>
	</StrictMode>,
);
