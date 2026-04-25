export interface Task {
  title: string;
  description: string;
  complexity: string;
  duration: string;
  dependency: string;
  risk: string;
  shouldTimeBlocked: boolean;
  isCompleted?: boolean;
}

export function createEmptyTask(): Task {
  return {
    title: '',
    description: '',
    complexity: '',
    duration: '',
    dependency: '',
    risk: '',
    shouldTimeBlocked: false,
    isCompleted: false,
  };
}
