export interface Task {
  id: number
  title: string;
  description: string;
  duration: number;
  isCompleted?: boolean;
  sequence: number;
}

export function createEmptyTask(): Task {
  return {
    id: 0,
    title: '',
    description: '',
    duration: 0,
    isCompleted: false,
    sequence: 1
  };
}
