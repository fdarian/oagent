import { Agentation } from 'agentation';
import { ConsolePage } from './pages/ConsolePage.tsx';

export function App() {
	return (
		<>
			<ConsolePage />
			{process.env.NODE_ENV === 'development' && <Agentation />}
		</>
	);
}
