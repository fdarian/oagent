import { Route, Routes } from 'react-router-dom';
import { AliasesPage } from './pages/AliasesPage.tsx';
import { ConsolePage } from './pages/ConsolePage.tsx';

export function App() {
	return (
		<Routes>
			<Route path="/" element={<ConsolePage />} />
			<Route path="/aliases" element={<AliasesPage />} />
		</Routes>
	);
}
