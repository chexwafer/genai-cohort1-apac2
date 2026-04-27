export interface Project {
  id: number
  title: string;
  description: string;
}

export function createEmptyProject(): Project {
  return {
    id: 0,
    title: '',
    description: ''
  };
}
