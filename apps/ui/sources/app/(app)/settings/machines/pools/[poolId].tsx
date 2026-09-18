import { useLocalSearchParams } from 'expo-router';
import { MachinePoolEditorRoute } from '@/components/settings/machines/pools/MachinePoolEditorScreen';

export default function EditMachinePoolRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; poolId?: string | string[] }>();
    return <MachinePoolEditorRoute params={params} />;
}
