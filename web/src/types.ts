// The shapes the API returns (api/src/routes/board.js and auth.js).

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  avatarHue: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  position: string;
  doneSectionId: string | null;
  createdAt: string;
}

export interface Section {
  id: string;
  projectId: string;
  name: string;
  position: string;
}

export type Priority = 'low' | 'medium' | 'high';
export type Status = 'on_track' | 'at_risk' | 'off_track';

export interface Task {
  id: string;
  projectId: string;
  sectionId: string | null;
  parentId: string | null;
  title: string;
  notes: string;
  assigneeId: string | null;
  dueOn: string | null;
  priority: Priority | null;
  status: Status | null;
  completed: boolean;
  completedAt: string | null;
  previousSectionId: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  subtaskCount: number;
  subtaskDoneCount: number;
  commentCount: number;
  likeCount: number;
  liked: boolean;
}

export interface Board {
  project: Project;
  sections: Section[];
  tasks: Task[];
  users: User[];
}

export interface Comment {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
  editedAt: string | null;
}

export interface Activity {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  actorId: string;
  createdAt: string;
}

export interface TaskDetail {
  task: Task;
  subtasks: Task[];
  comments: Comment[];
  activity: Activity[];
}

export interface Session {
  token: string;
  expiresAt: string;
  user: User;
}
