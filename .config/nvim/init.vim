set encoding=utf-8
let mapleader = ','
set bs=eol,start,indent
set ic is scs sw=4 ts=4 et termguicolors hidden nu splitbelow splitright mouse=a diffopt+=vertical laststatus=0

call plug#begin('~/.vim/bundle')
"{{{
Plug 'scrooloose/nerdtree'
"{{{
"NERDTreefind
nnoremap <silent> ff :NERDTreeFind <Enter>
"NERDTree toggle
nnoremap <silent> <C-n> :NERDTreeToggle<CR>
"}}}

Plug 'morhetz/gruvbox'

Plug 'tpope/vim-surround'
Plug 'christoomey/vim-tmux-navigator'
Plug 'tpope/vim-fugitive'
"{{{
"fugitive vim
nnoremap gw :Gwrite<Enter>
nnoremap gs :Gstatus<Enter>
nnoremap gc :Gcommit<Enter>
nnoremap gp :Gpush
nnoremap gpf :Gpush --force
nnoremap gca :Gcommit --amend
nnoremap gpl :Gpull --rebase
" Commenting for fugitive commit session
" will take branch name as #Issue-number
let @w='5G$vByggIIssue #000 feat: <CR><CR><ESC>pggA'
let @e='ggIIssue #000 feat: '
let @r='ggIIssue #000 fix: '
"}}}
" Plugin to show git commit popup
Plug 'rhysd/git-messenger.vim'

Plug 'junegunn/fzf.vim'
Plug 'tpope/vim-rhubarb'
Plug 'scrooloose/nerdcommenter'
"{{{
" Add spaces after comment delimiters by default
let g:NERDSpaceDelims = 1

" Use compact syntax for prettified multi-line comments
let g:NERDCompactSexyComs = 1
" Align line-wise comment delimiters flush left instead of following code indentation
let g:NERDDefaultAlign = 'left'
" Allow commenting and inverting empty lines (useful when commenting a region)
let g:NERDCommentEmptyLines = 1
" Enable trimming of trailing whitespace when uncommenting
let g:NERDTrimTrailingWhitespace = 1
"}}}

Plug 'fatih/vim-go', { 'do': ':GoUpdateBinaries', 'for': 'go' }

Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'tpope/vim-unimpaired'
Plug 'tpope/vim-dispatch'
Plug 'radenling/vim-dispatch-neovim'
Plug 'vim-scripts/vim-auto-save'
let g:auto_save_noupdatetime = 1
let g:auto_save_in_insert_mode = 0


Plug 'vimwiki/vimwiki'
"{{{
" customization for wiki
let wiki_personal= {'path': '~/vimwiki_personal/', 'syntax': 'markdown', 'ext': '.md'}
let wiki_work = {'path': '~/vimwiki/', 'syntax': 'markdown', 'ext': '.md'}
let g:vimwiki_list = [wiki_work, wiki_personal]
let g:vimwiki_ext2syntax = {'.md': 'markdown',
                  \ '.mkd': 'markdown',
                  \ '.wiki': 'media'}
let g:vimwiki_folding='custom'
map gc<Space> <Plug>VimwikiToggleListItem
"}}}

Plug 'wincent/ferret'
"{{{
let g:FerretJob=0
let g:FerretMaxResults=1000
" vnoremap /s "zy:Ack! -w --ignore *\.wiki --ignore *doc --ignore ekstep-devops <c-r>z<CR>
vnoremap <silent> /S "zy:Ack! -w  <c-r>z<CR>
vnoremap <silent> /s "zy:Ack!  <c-r>z<CR>
"}}}

Plug 'easymotion/vim-easymotion'
"{{{
" Easymotion plug
" Jump to anywhere you want with minimal keystrokes, with just one key binding.
" `s{char}{label}`
nmap <silent> z <Plug>(easymotion-overwin-f2)

" Replacing hjkl
" Gif config
map  <silent> <Leader>j <Plug>(easymotion-j)
map <silent> <Leader>k <Plug>(easymotion-k)
let g:EasyMotion_startofline = 0 " keep cursor column when JK motion
"}}}
" Iconpack for vim
Plug 'ryanoasis/vim-devicons'
Plug 'nvie/vim-flake8'
" Autocomplete engine
"{{{
if has('nvim')
  Plug 'Shougo/deoplete.nvim', { 'do': ':UpdateRemotePlugins' }
  let g:deoplete#enable_at_startup = 1
  Plug 'tbodt/deoplete-tabnine', { 'do': './install.sh' }

endif
"}}}

Plug 'SirVer/ultisnips'
"{{{
" Trigger configuration. Do not use <tab> if you use https://github.com/Valloric/YouCompleteMe.
let g:UltiSnipsExpandTrigger="<c-l>"
let g:UltiSnipsJumpForwardTrigger="<c-j>"
let g:UltiSnipsJumpBackwardTrigger="<c-k>"
"}}}

Plug 'andrewstuart/vim-kubernetes'
Plug 'pearofducks/ansible-vim', { 'do': 'cd ./UltiSnips; ./generate.py --style dictionary' }
"{{{
let g:ansible_attribute_highlight = "ob"
let g:ansible_name_highlight = 'd'
let g:ansible_extra_keywords_highlight = 1
let g:ansible_normal_keywords_highlight = 'Constant'
"}}}

Plug 'michaeljsmith/vim-indent-object'
Plug 'mustache/vim-mustache-handlebars'
let g:mustache_abbreviations = 1

Plug 'mbbill/undotree'

" Initialize plugin system
call plug#end()
"}}}

" colorscheme solarized8_flat
colorscheme gruvbox
set background=dark
let g:gruvbox_contrast_dark = 'medium'
let g:gruvbox_italicize_comments = 1

" Deoplete configuration
" {{{
" populate vim-go plugin suggestions
call deoplete#custom#option('omni_patterns', {
    \ 'go': '[^. *\t]\.\w*',
    \})
call deoplete#custom#var('tabnine', {
    \ 'line_limit': 500,
    \ 'max_num_results': 20,
    \ })
call deoplete#custom#source('tabnine', 'rank', 50)
"}}}

" Kite config
"{{{
" ref: https://github.com/kiteco/plugins/tree/master/vim

let g:kite_tab_complete=1

" Disabling previw window
set completeopt+=preview

" Automatically close if completion is done
autocmd CompleteDone * if !pumvisible() | pclose | endif

" snippet placeholder changing
let g:kite_previous_placeholder = '<tab>'
let g:kite_next_placeholder = '<s-tab>'

" Copilot changing
nmap <silent> <buffer> gK <Plug>(kite-docs)
let g:kite_documentation_continual=1
"}}}


" Custom Undo
set undofile
if !has('nvim')
    set undodir=~/.vim/undo
endif

" Functions
" {{{
function! Term()
  exec winheight(0)/4."split" | set nonu | terminal
endfunction
if has('nvim')
     nnoremap <expr> <leader>t ":call Term()\<CR>"
     nnoremap <expr> <leader>T ":call TermTab()\<CR>"
endif

function! TermTab()
  tabnew | set nonu | terminal
endfunction

function! TrailClear()
    :%s/\s\+$//g
endfunction
command! TrailClear call TrailClear()

function! DiffToggle(diff)
    "named argument diff
    if a:diff
        :windo diffoff
    else
        :windo diffthis
    endif
endfunction

function! PyRunner()
    :Dispatch! python %
endfunction
command! PyRunner call PyRunner()

function! DiffToggle(diff)
    "named argument diff
    if a:diff
        :windo diffoff
    else
        :windo diffthis
    endif
endfunction
nnoremap <silent> <leader>d :call DiffToggle(&diff)<CR>

" Ansible variable fix {{var}} to {{ var }}
function! AnsiVarFix()
    :%s/{{\(\w\+\)}}/{{ \1 }}/g
endfunction
command! AnsiVarFix call AnsiVarFix()

"}}}

"Commands {{{
com! FormatJSON %!python -m json.tool
"}}}

" Keyboard Mappings
" {{{
" Quit
nnoremap <leader>w :w<Enter>
nnoremap <leader>q :q<Enter>
nnoremap <leader>Q :qa<Enter>
nnoremap <leader>wq :wq<Enter>
nnoremap <leader>wQ :wqa!<Enter>

" Folding
" au BufNewFile,BufRead *.py,*.go set foldmethod=indent
vnoremap <silent> <space> :fold<CR>
nnoremap <silent> <space> za<CR>


" visual select
vnoremap // "zy/<C-R>z<CR>
vnoremap /b "zy:Back! <C-R>z<CR>
vnoremap /B "zy:Back! -w <C-R>z<CR>

" Copying to system clipboard
vnoremap Y "+y
nnoremap <C-p> :<C-u>FZF<cr>

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
nnoremap <silent> ]r 0f-WvEy:find roles/<c-r>0/tasks/main.yml<CR>

"Undo map
nnoremap <silent> U :UndotreeToggle<CR>:UndotreeFocus<CR>

" Command mode history
cmap <M-p> <up>
cmap <M-n> <down>
cmap <M-k> <up>
cmap <M-j> <down>
" tabbing to complete popups
inoremap <silent><expr><tab> pumvisible() ? "\<c-n>" : "\<tab>"
inoremap <silent><expr><s-tab> pumvisible() ? "\<c-p>" : "\<s-tab>"
"}}}

" Buffer Mappings
"{{{
augroup filetypes
    autocmd!
    " autocmd BufEnter,BufWritePre *.yml set foldmethod=indent foldlevel=10
    autocmd Filetype vim,python,sh setlocal foldmethod=marker shiftwidth=4 tabstop =4  expandtab
    autocmd Filetype yaml setlocal shiftwidth=2 tabstop=2 expandtab
    autocmd Filetype gitcommit setlocal spell
    autocmd Filetype git setlocal nofoldenable
    autocmd BufEnter ".*\.md$" setlocal spell tabstop=2 expandtab shiftwidth=2 foldmethod=marker
    autocmd BufEnter Jenkinsfile setlocal ft=groovy
    autocmd FileType vimwiki let b:auto_save=1
    "custom file based remapings
    au FileType go nmap <leader>gr <Plug>(go-run)
    au FileType go nmap <leader>gt <Plug>(go-test)
augroup END
"}}}

" Experimentals
"
" Append modeline after last line in buffer.{{{
" Use substitute() instead of printf() to handle '%%s' modeline in LaTeX
" files.
function! AppendModeline()
  let l:modeline = printf(" vim: set ts=%d sw=%d tw=%d %set :",
        \ &tabstop, &shiftwidth, &textwidth, &expandtab ? '' : 'no')
  let l:modeline = substitute(&commentstring, "%s", l:modeline, "")
  call append(line("0"), l:modeline)
endfunction
nnoremap <silent> <Leader>ml :call AppendModeline()<CR>
"}}}


" Popup window for fzf
" Terminal buffer options for fzf
autocmd! FileType fzf
autocmd  FileType fzf set noshowmode noruler nonu

if has('nvim') && exists('&winblend') && &termguicolors
  set winblend=20

  hi NormalFloat guibg=None
  if exists('g:fzf_colors.bg')
    call remove(g:fzf_colors, 'bg')
  endif

  if stridx($FZF_DEFAULT_OPTS, '--border') == -1
    let $FZF_DEFAULT_OPTS .= ' --border'
  endif

  function! FloatingFZF()
    let width = float2nr(&columns * 0.8)
    let height = float2nr(&lines * 0.6)
    let opts = { 'relative': 'editor',
               \ 'row': (&lines - height) / 2,
               \ 'col': (&columns - width) / 2,
               \ 'width': width,
               \ 'height': height }

    call nvim_open_win(nvim_create_buf(v:false, v:true), v:true, opts)
  endfunction

  let g:fzf_layout = { 'window': 'call FloatingFZF()' }
endif

command! -bang -nargs=? -complete=dir Files
        \ call fzf#vim#files(<q-args>, fzf#vim#with_preview({'options': ['--layout=reverse', '--info=inline']}), <bang>0)

