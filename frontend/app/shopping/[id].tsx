import { useLocalSearchParams } from 'expo-router';
import ShoppingEditor from '@/src/ShoppingEditor';
export default function EditShopping() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ShoppingEditor id={id as string} />;
}
