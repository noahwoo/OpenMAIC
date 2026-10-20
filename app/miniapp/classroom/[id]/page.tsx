'use client';
import { useParams } from 'next/navigation';
import { ClassroomSurface } from '@/components/classroom/ClassroomSurface';
export default function MiniappClassroom() {
  const { id } = useParams<{ id: string }>();
  return <ClassroomSurface classroomId={id} mobile />;
}
