import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth, Course } from '@/src/auth';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { PrefsScreenShell } from '@/src/PrefsScreenShell';
import { CategoryListEditor } from '@/src/CategoryListEditor';
import { COURSE_EMOJI_CATALOG } from '@/src/courseIcons';

export default function CoursesPreference() {
  const { t, tCourse } = useTranslation();
  const { prefs, updatePreferences } = useAuth();
  const [courses, setCourses] = useState<Course[]>(prefs.courses);
  useEffect(() => setCourses(prefs.courses), [prefs.courses]);

  const dirty = JSON.stringify(courses.map(c => ({ id: c.id || '', label: c.label, icon: c.icon || null })))
    !== JSON.stringify((prefs.courses || []).map(c => ({ id: c.id || '', label: c.label, icon: c.icon || null })));

  return (
    <PrefsScreenShell
      title={t('prefs.courses.h')}
      dirty={dirty}
      onSave={() => updatePreferences({ courses })}
      testID="prefs-courses"
    >
      <View style={s.section}>
        <Text style={s.sectionSub}>{t('prefs.courses.sub')}</Text>
        <CategoryListEditor
          items={courses}
          setItems={(next) => setCourses(next as Course[])}
          emojiCatalog={COURSE_EMOJI_CATALOG}
          labelResolver={(c) => tCourse(c as Course)}
          addLabel={t('prefs.addCategory')}
          newTitle={t('prefs.newCategory')}
          renameTitle={t('prefs.renameCategory')}
          examplePh={t('prefs.courseExamplePh')}
          testPrefix="course"
        />
      </View>
    </PrefsScreenShell>
  );
}
