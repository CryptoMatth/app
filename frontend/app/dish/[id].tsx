import { useLocalSearchParams } from 'expo-router';
import DishEditor from '@/src/DishEditor';
export default function EditDish() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DishEditor id={id as string} />;
}
