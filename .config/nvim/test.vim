" vim:set ft=vim: "
set encoding=utf-8
let mapleader = ' '
set bs=eol,start,indent
set ic is scs sw=4 ts=4 et termguicolors hidden nu splitbelow splitright mouse=a diffopt+=vertical laststatus=0 cursorline
colorscheme industry

call plug#begin('~/.vim/bundle')
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}  "We recommend updating the parsers on update
call plug#end()

" Themes
" {{{
" colorscheme solarized8_flat
" colorscheme molokai
colorscheme gruvbox
let g:airline_theme='distinguished'
" colorscheme nord
" set background=dark
let g:gruvbox_contrast_dark = 'medium'
let g:gruvbox_italicize_comments = 1
" }}}

" AuGroup Commands
" {{{
augroup auto_go
    autocmd!
    autocmd FileType go set foldmethod=syntax foldlevel=1 foldnestmax=2
    autocmd BufWritePre *.go :GoDiagnostics
    autocmd BufWritePost *_test.go :GoTest
augroup end

augroup auto_vim
    autocmd!
    autocmd FileType vim set foldmethod=marker
augroup END

augroup auto_vimwiki
    autocmd!
    au BufEnter,BufNewFile ~/vimwiki/* let b:auto_save=1 | lcd ~/vimwiki | setlocal spell sw=2 sts=2 et ts=2
augroup END

augroup auto_markdown_gitcommit
    autocmd!
    autocmd FileType markdown,gitcommit setlocal spell sw=2 sts=2 et ts=2
augroup END

augroup auto_yaml
    autocmd!
    autocmd FileType yaml setlocal sw=2 sts=2 et ts=2 | nnoremap <silent> ]r :call FindAnsibleRoleUnderCursor()<CR>
augroup END
augroup auto_ansible
    autocmd!
    au BufEnter,BufNewFile */ansible/*.y[a]\\\{0,1\}ml setlocal ft=yaml.ansible
augroup END
" }}}

" Custom Undo
set undofile
if !has('nvim')
    set undodir=~/.vim/undo
endif

" Functions
" {{{
function! DiffToggle(diff)
    "named argument diff
    if a:diff
        :windo diffoff
    else
        :windo diffthis
    endif
endfunction
nnoremap <silent> <leader>d :call DiffToggle(&diff)<CR>


let g:ansible_goto_role_paths = './roles,../_common/roles'

function! FindAnsibleRoleUnderCursor()
  if exists("g:ansible_goto_role_paths")
    let l:role_paths = g:ansible_goto_role_paths
  else
    let l:role_paths = "./roles"
  endif
  let l:tasks_main = expand("<cfile>") . "/tasks/main.yml"
  let l:found_role_path = findfile(l:tasks_main, l:role_paths)
  if l:found_role_path == ""
    echo l:tasks_main . " not found"
  else
    execute "edit " . fnameescape(l:found_role_path)
  endif
endfunction

" }}}

" Keyboard Mappings
" {{{
" Vista function overview
nnoremap <leader>v :Vista finder<CR>

nnoremap <silent><leader>w :w<CR>
" quit
nnoremap <silent><leader>q :q<CR>
nnoremap <silent><leader>Q :qa<CR>
" Folding
nnoremap <silent><leader>f za
nnoremap <silent><leader>F zA
vnoremap <silent><leader>f :fold<CR>

" visual select
vnoremap // "zy/<C-R>z<CR>
vnoremap /b "zy:Back! <C-R>z<CR>
vnoremap /B "zy:Back! -w <C-R>z<CR>

" Copying to system clipboard
vnoremap Y "+y

" Switch windows
nnoremap <c-j> <c-w>j
nnoremap <c-k> <c-w>k
nnoremap <c-h> <c-w>h
nnoremap <c-l> <c-w>l
if has('nvim')
    " Escape mode
    tnoremap <C-b><C-b> <C-\><C-n>
    " shell jumping
    tnoremap <c-h> <c-\><c-n><c-w>h
    tnoremap <c-j> <c-\><c-n><c-w>j
    tnoremap <c-k> <c-\><c-n><c-w>k
    tnoremap <c-l> <c-\><c-n><c-w>l
endif

"Undo map
nnoremap <silent> U :UndotreeToggle<CR>:UndotreeFocus<CR>

" Command mode history
cmap <M-h> <left>
cmap <M-l> <right>
cmap <M-k> <up>
cmap <M-j> <down>
" tabbing to complete popups
inoremap <silent><expr><tab> pumvisible() ? "\<c-n>" : "\<tab>"
inoremap <silent><expr><s-tab> pumvisible() ? "\<c-p>" : "\<s-tab>"

" search through buffers using fzf
nnoremap <silent><leader>b :Buffers<CR>
" search through files in current dir using fzf
nnoremap <C-p> :<C-u>Files<cr>
" search through history using fzf
nnoremap <silent><leader>h :History<CR>

"}}}


" GUI configs
" set guifont=FiraCode:h16
set guifont=FiraCode\ Nerd\ Font:h12
" set guifont=FiraCode\ Nerd\ Font\\:style\\=Medium\\,Regular:h16
" set guifont=FiraCode\ Nerd\ Font\ Mono\\:style\\=Light\\,Regular:h12
" set guifont=Source\ Code\ Pro\\,Source\ Code\ Pro\ Semibold:h16
