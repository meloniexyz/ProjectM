import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, Modal, Pressable, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useStore } from '../../../../src/renderer/src/lib/store'
import { CollectionHeader } from '../../components/CollectionHeader'
import { TrackList } from '../../components/TrackRow'
import { Artwork, Button, Empty, Header, IconButton, Txt } from '../../components/ui'
import { deletePlaylist, libStore, pickCover, updatePlaylistDetails } from '../../lib/library'
import { useColors, ui } from '../../lib/theme'

export default function PlaylistScreen() {
  const c = useColors()
  const { id } = useLocalSearchParams<{ id: string }>()
  const playlist = useStore(libStore, (s) => s.playlists.find((p) => p.id === id))
  const [editing, setEditing] = useState(false)
  if (!playlist) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <Header title="Playlist" />
        <Empty title="This playlist was deleted" />
      </View>
    )
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header
        title={playlist.name}
        right={<IconButton name="create-outline" label="Edit details" onPress={() => setEditing(true)} />}
      />
      <TrackList
        tracks={playlist.tracks}
        playlistId={playlist.id}
        header={
          <CollectionHeader
            title={playlist.name}
            sub={playlist.description ?? 'ProjectM playlist'}
            artwork={playlist.cover ?? playlist.tracks[0]?.artwork}
            tracks={playlist.tracks}
            downloadKey={`playlist:${playlist.id}`}
          />
        }
        empty={
          <Empty
            icon="add-circle-outline"
            title="Add songs to this playlist"
            text="Tap + on any song (or the player) and pick this playlist. Playlists can mix songs from every platform."
            action={<Button small kind="secondary" title="Find songs" onPress={() => router.push('/search')} />}
          />
        }
      />
      {editing ? <EditDetails id={playlist.id} onClose={() => setEditing(false)} /> : null}
    </View>
  )
}

function EditDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const p = libStore.get().playlists.find((x) => x.id === id)!
  const [name, setName] = useState(p.name)
  const [description, setDescription] = useState(p.description ?? '')
  const [cover, setCover] = useState<string | undefined>(p.cover)
  const input = { color: c.text, backgroundColor: c.bg3, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.elev, padding: ui.pad, paddingBottom: insets.bottom + 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Button small kind="ghost" title="Cancel" onPress={onClose} />
          <Txt size={17} weight="800" style={{ flex: 1, textAlign: 'center' }}>
            Edit details
          </Txt>
          <Button
            small
            title="Save"
            disabled={!name.trim()}
            onPress={() => {
              updatePlaylistDetails(id, { name, description, cover })
              onClose()
            }}
          />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Change cover" onPress={async () => setCover((await pickCover()) ?? cover)} style={{ alignSelf: 'center', alignItems: 'center', gap: 6 }}>
          <Artwork src={cover ?? p.tracks[0]?.artwork} size={160} radius={6} />
          <Txt tone="text2" size={13} weight="600">
            Change cover
          </Txt>
        </Pressable>
        {cover ? <Button small kind="ghost" title="Remove custom cover" onPress={() => setCover(undefined)} style={{ alignSelf: 'center' }} /> : null}
        <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={c.text3} style={input} />
        <TextInput value={description} onChangeText={setDescription} placeholder="Description (optional)" placeholderTextColor={c.text3} multiline style={[input, { minHeight: 80 }]} />
        <View style={{ flex: 1 }} />
        <Button
          kind="danger"
          title="Delete playlist"
          onPress={() =>
            Alert.alert('Delete playlist?', `"${p.name}" will be removed from ProjectM.`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  onClose()
                  deletePlaylist(id)
                  router.back()
                },
              },
            ])
          }
        />
      </View>
    </Modal>
  )
}
