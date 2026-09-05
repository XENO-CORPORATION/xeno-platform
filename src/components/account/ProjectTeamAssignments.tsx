import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getWorkspaceTeams, type OperationalTeam } from '../../services/accountService';

/** Mount with a workspace/project key so a context switch cannot retain old assignments. */
export default function ProjectTeamAssignments({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<OperationalTeam[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setTeams(null); setError('');
    getWorkspaceTeams(workspaceId).then(result => {
      if (current) setTeams(result.teams.filter(team => team.projects.some(project => project.id === projectId)));
    }).catch(cause => {
      if (current) setError(cause instanceof Error ? cause.message : 'Team assignments are unavailable.');
    });
    return () => { current = false; };
  }, [workspaceId, projectId]);
  return <div className="xeno-project-form">
    <h3>Assigned teams</h3>
    {error ? <p role="alert">{error}</p> : teams === null ? <p role="status">Loading team assignments…</p> : teams.length ? teams.map(team => <p key={team.id}>{team.name}</p>) : <p>No teams assigned.</p>}
    <p>Team assignments organize this project without changing execution or filesystem permissions.</p>
    <button type="button" className="xeno-page-button" onClick={() => navigate('/overview/teams')}>View workspace teams</button>
  </div>;
}
