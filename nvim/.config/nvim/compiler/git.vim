" Vim compiler file

scriptencoding utf-8

if exists("current_compiler")
  finish
endif
let current_compiler = "git"

let s:cpo_save = &cpo
set cpo-=C

if exists('g:fugitive_git_executable')
  execute 'CompilerSet makeprg='.escape(g:fugitive_git_executable, ' "\')
else
  CompilerSet makeprg=git
endif

CompilerSet errorformat=
      \%-G%.%#%\\r%.%\\+,
      \Cloning\ into%.%#\ '%f'...,
      \Клониране\ и\ създаване\ на\ %.%#\ хранилище\ в\ „%f“…,
      \Klone\ nach%.%#\ '%f'...,
      \Clonage\ dans%.%#\ '%f'...,
      \Clonar\ em%.%#\ '%f'...,
      \Klonar\ till%.%#\ \"%f\"...,
      \Đang\ nhân\ bản\ thành%.%#\ “%f”...,
      \正克隆到\ '%f'...,
      \%+Egit:\ %m,
      \%+Eerror:\ %m,
      \%+Wwarning:\ %m,
      \%+Iusage\ %#:\ %m,
      \%+Iупотреба:\ %m,
      \%+IVerwendung:\ %m,
      \%+I\ %#uso:\ %m,
      \%+Ianvändning:\ %m,
      \%+Icách\ dùng:\ %m,
      \%+I用法：%m,
      \%+Efatal\ %#:\ %m,
      \%+Eфатална\ грешка:\ %m,
      \%+Eödesdigert:\ %m,
      \%+Enghiêm\ trọng:\ %m,
      \%+E严重错误：\ %m,
      \%+ECannot\ %.%#:\ You\ have\ unstaged\ changes.,
      \%+ECannot\ %.%#:\ Your\ index\ contains\ uncommitted\ changes.,
      \%+EThere\ is\ no\ tracking\ information\ for\ the\ current\ branch.,
      \%+EYou\ are\ not\ currently\ on\ a\ branch.\ Please\ specify\ which,
      \CONFLICT\ (%m):\ %f\ deleted\ in\ %.%#,
      \CONFLICT\ (%m):\ Merge\ conflict\ in\ %f,
      \CONFLICT\ (%m):\ Rename\ \"%f\"->%.%#,
      \CONFLICT\ (%m):\ Rename\ %.%#->%f\ %.%#,
      \CONFLICT\ (%m):\ There\ is\ a\ directory\ with\ name\ %f\ in\ %.%#,
      \%+ECONFLICT\ %.%#,
      \%+EKONFLIKT\ %.%#,
      \%+ECONFLIT\ %.%#,
      \%+EXUNG\ ĐỘT\ %.%#,
      \%+E冲突\ %.%#,
      \%\\w%\\t%f

let &cpo = s:cpo_save
unlet s:cpo_save
