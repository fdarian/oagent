import { useQuery } from '@tanstack/react-query'
import { orpc } from '../lib/orpc.ts'

interface JobListProps {
  onSelectJob: (id: string) => void
}

export function JobList({ onSelectJob }: JobListProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => orpc.jobs.list(),
    refetchInterval: (query) => {
      const jobs = query.state.data as Array<{ status: string }> | undefined
      if (jobs !== undefined && jobs.some((j) => j.status === 'running')) {
        return 2000
      }
      return false
    },
  })

  if (isLoading) {
    return <div className="p-6 text-gray-500">Loading...</div>
  }

  const jobs = data ?? []

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">oagent</h1>
      <h2 className="text-sm font-medium text-gray-400 mb-3">Jobs</h2>
      {jobs.length === 0 ? (
        <p className="text-gray-500 italic">No jobs yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-800">
              <th className="pb-2 pr-4">ID</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Started</th>
              <th className="pb-2">Finished</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b border-gray-800">
                <td className="py-2 pr-4">
                  <button
                    onClick={() => onSelectJob(job.id)}
                    className="text-blue-400 hover:underline truncate max-w-[200px]"
                  >
                    {job.id.slice(0, 20)}
                    {job.id.length > 20 ? '…' : ''}
                  </button>
                </td>
                <td className="py-2 pr-4">{statusBadge(job.status)}</td>
                <td className="py-2 pr-4 text-gray-400">{formatAge(job.createdAt)}</td>
                <td className="py-2 text-gray-400">
                  {job.terminatedAt !== undefined ? formatAge(job.terminatedAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function statusBadge(status: string) {
  const classes: Record<string, string> = {
    running: 'bg-blue-900 text-blue-200',
    done: 'bg-green-900 text-green-200',
    error: 'bg-red-900 text-red-200',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${classes[status] ?? 'bg-gray-800 text-gray-300'}`}>
      {status}
    </span>
  )
}

function formatAge(ms: number): string {
  const secs = Math.floor((Date.now() - ms) / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}
