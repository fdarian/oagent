import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { queryClient } from './lib/query.ts';
import { ThemeProvider } from './lib/theme.tsx';
import { router } from './router.ts';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Root element not found');
createRoot(root).render(
	<StrictMode>
		<ThemeProvider>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</ThemeProvider>
	</StrictMode>,
);
