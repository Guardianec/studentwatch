export const students = [
  { id: 'maya', name: 'Мая Вернигора', group: '9-А' },
  { id: 'lev', name: 'Лев Степаненко', group: '10-Б' },
  { id: 'sofia', name: 'Софія Нечай', group: '11-А' },
  { id: 'dan', name: 'Данило Боровик', group: '9-А' },
  { id: 'olena', name: 'Олена Яворська', group: '10-Б' },
  { id: 'mark', name: 'Марко Левицький', group: '11-А' },
] as const

export type Student = typeof students[number]
export type Status = 'На перевірці' | 'Підтверджено' | 'Потребує уточнення' | 'Чернетка'

type Achievement = {
  id: string
  student: Student['id']
  contest: string
  date: string
  result: string
  status: Status
}

export const achievements: Achievement[] = [
  { id: '1', student: 'maya', contest: 'Олімпіада з інформатики', date: '2026-11-09', result: 'II місце', status: 'На перевірці' },
  { id: '2', student: 'lev', contest: 'Мала академія наук', date: '2026-11-08', result: 'Участь', status: 'На перевірці' },
  { id: '3', student: 'sofia', contest: 'Олімпіада зі штучного інтелекту', date: '2026-11-07', result: 'III місце', status: 'На перевірці' },
  { id: '4', student: 'dan', contest: 'Юніорська олімпіада', date: '2026-11-06', result: 'Участь', status: 'Підтверджено' },
  { id: '5', student: 'olena', contest: 'Дівоча олімпіада', date: '2026-11-05', result: 'I місце', status: 'Підтверджено' },
  { id: '6', student: 'mark', contest: 'ICPC', date: '2026-11-04', result: 'Командна участь', status: 'Потребує уточнення' },
  { id: '7', student: 'maya', contest: 'Олімпіада геніїв', date: '2026-11-02', result: 'Участь', status: 'Підтверджено' },
  { id: '8', student: 'lev', contest: 'Олімпіада з інформатики', date: '2026-10-29', result: 'Участь', status: 'Чернетка' },
]

export const groups = [...new Set(students.map(({ group }) => group))]
export const pending = achievements.filter(({ status }) => status === 'На перевірці')
