import { useState } from 'react'
import { JobList } from './pages/JobList.tsx'
import { JobDetail } from './pages/JobDetail.tsx'

export function App() {
  const [page, setPage] = useState<'list' | { type: 'detail'; id: string }>('list')

  if (page === 'list') {
    return <JobList onSelectJob={(id) => setPage({ type: 'detail', id })} />
  }

  return <JobDetail jobId={page.id} onBack={() => setPage('list')} />
}
